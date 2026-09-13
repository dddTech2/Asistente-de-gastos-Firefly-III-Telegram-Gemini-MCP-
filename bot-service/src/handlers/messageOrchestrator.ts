import type { Content } from "@google/genai";
import type { GeminiClient } from "../gemini/geminiClient.js";
import { construirContents, construirSystemPrompt } from "../gemini/promptBuilder.js";
import { adaptarToolsDeMcpAGemini } from "../gemini/toolDeclarationsAdapter.js";
import { clasificarToolCall } from "../mcp/toolClassification.js";
import { resumirAccionIrreversible } from "../mcp/resumenAccionIrreversible.js";
import type { McpToolExecutor, ResultadoTool } from "../mcp/mcpToolExecutor.js";
import type { HistorialMensaje, HistoryStore } from "../conversation/historyStore.js";
import { logger } from "../lib/logger.js";

export interface CredentialResolverParaOrquestador {
  getUserCredentials(chatId: number): Promise<{ pat: string }>;
}

/**
 * Forma mínima que necesita `messageOrchestrator.ts` de
 * `confirmacionAccionIrreversible.solicitarConfirmacion` (historia 4.3) --
 * sin `bot` (tipo de `grammy`) para mantener este módulo testeable sin un
 * `Bot` real, igual que el resto de sus dependencias. `server.ts` (historia
 * 5.14) es quien adapta la función real con el `bot` ya construido.
 */
export interface ConfirmadorAccionIrreversible {
  solicitarConfirmacion(chatId: number, resumenAccion: string, ejecutar: () => Promise<void>): Promise<void>;
}

export interface MessageOrchestratorDeps {
  geminiClient: GeminiClient;
  mcpToolExecutor: McpToolExecutor;
  historyStore: HistoryStore;
  credentialResolver: CredentialResolverParaOrquestador;
  /** Historia 5.14. Opcional: si una tool irreversible aparece sin este dependency configurado, falla explícito en vez de ejecutar sin confirmar. */
  confirmador?: ConfirmadorAccionIrreversible;
  /** Historia 5.14. Envía la respuesta final al usuario cuando se completó tras una confirmación (procesarMensaje ya había devuelto `null` antes). */
  enviarMensaje?: (chatId: number, texto: string) => Promise<void>;
  /** Inyectable para tests -- default `() => new Date()`. */
  ahora?: () => Date;
}

export interface MessageOrchestrator {
  /** `null` significa "ya se envió todo lo necesario" (historia 5.14: se pidió confirmación de una acción irreversible; no hay más nada que enviar ahora). */
  procesarMensaje(chatId: number, mensajeUsuario: string): Promise<string | null>;
}

const MENSAJE_SIN_RESPUESTA_FINAL =
  "No pude terminar de procesar tu pedido. Intentá reformularlo o probá de nuevo en un momento.";

/**
 * Tope de rondas tool-call -> MCP -> Gemini dentro de UN mismo mensaje del
 * usuario. Es una guarda de seguridad (fail-safe ante un ciclo de tool calls
 * que nunca converge a una respuesta de texto), no una funcionalidad pedida
 * por ningún AC -- el valor es deliberadamente chico. [Inference]
 */
const MAX_RONDAS_TOOL_CALL = 4;

const CONFIRMADOR_NO_CONFIGURADO: ConfirmadorAccionIrreversible = {
  async solicitarConfirmacion() {
    throw new Error(
      "MessageOrchestrator: Gemini solicitó una tool irreversible pero no hay `confirmador` configurado.",
    );
  },
};

async function enviarMensajeNoConfigurado(): Promise<void> {
  throw new Error("MessageOrchestrator: se necesita `enviarMensaje` para completar una acción confirmada, pero no fue configurado.");
}

async function obtenerHistorialSeguro(historyStore: HistoryStore, chatId: number): Promise<HistorialMensaje[]> {
  try {
    return await historyStore.getRecentMessages(chatId);
  } catch (error) {
    // Edge case de Testing (5.1): "Redis no disponible... no debe tirar la
    // app entera" -- se degrada a "sin historial" en vez de propagar.
    logger.warn(
      { chat_id: chatId, err: error instanceof Error ? error : new Error(String(error)) },
      "No se pudo leer el historial de conversación, se continúa sin historial previo",
    );
    return [];
  }
}

async function guardarMensajeSeguro(historyStore: HistoryStore, chatId: number, mensaje: HistorialMensaje): Promise<void> {
  try {
    await historyStore.appendMessage(chatId, mensaje);
  } catch (error) {
    logger.warn(
      { chat_id: chatId, err: error instanceof Error ? error : new Error(String(error)) },
      "No se pudo guardar un mensaje en el historial de conversación",
    );
  }
}

function agregarResultadoTool(
  contents: Content[],
  nombreTool: string,
  argumentos: Record<string, unknown>,
  resultado: ResultadoTool,
): Content[] {
  return [
    ...contents,
    { role: "model", parts: [{ functionCall: { name: nombreTool, args: argumentos } }] },
    {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: nombreTool,
            response: resultado.esError ? { error: resultado.contenido } : { resultado: resultado.contenido },
          },
        },
      ],
    },
  ];
}

/**
 * AC #1, #3, #4 (historia 5.1): orquesta el ciclo completo -- arma el prompt
 * (system + historial + tools), llama a Gemini, y si responde con un
 * `functionCall` ejecuta la tool contra el MCP y reenvía el resultado a
 * Gemini para la respuesta final; si responde directo con texto, no llama a
 * ninguna tool.
 *
 * Historia 5.14: antes de ejecutar una tool call, la clasifica con
 * `clasificarToolCall` (4.3). Si es `"irreversible"`, en vez de ejecutarla
 * pide confirmación (`deps.confirmador`) y DIFIERE el resto del ciclo
 * (ejecución + segunda llamada a Gemini + envío de la respuesta final +
 * guardado en historial) a la función `ejecutar` que le pasa al confirmador
 * -- `procesarMensaje` devuelve `null` de inmediato en ese caso, ya que el
 * pedido de confirmación es la única respuesta que corresponde enviar por
 * ahora. `ejecutarRondas` es recursiva para poder reanudar exactamente donde
 * se interrumpió el ciclo (mismos `contents` acumulados, mismo número de
 * ronda) una vez que el usuario confirma.
 */
export function createMessageOrchestrator(deps: MessageOrchestratorDeps): MessageOrchestrator {
  const ahora = deps.ahora ?? (() => new Date());
  const confirmador = deps.confirmador ?? CONFIRMADOR_NO_CONFIGURADO;
  const enviarMensaje = deps.enviarMensaje ?? enviarMensajeNoConfigurado;

  async function ejecutarRondas(
    chatId: number,
    pat: string,
    systemInstruction: string,
    tools: ReturnType<typeof adaptarToolsDeMcpAGemini>,
    contentsIniciales: Content[],
    rondaInicial: number,
  ): Promise<string | null | undefined> {
    let contents = contentsIniciales;

    for (let ronda = rondaInicial; ronda < MAX_RONDAS_TOOL_CALL; ronda++) {
      const respuesta = await deps.geminiClient.generarRespuesta({ systemInstruction, contents, tools });
      const functionCalls = respuesta.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        return respuesta.text ?? "";
      }

      const llamada = functionCalls[0]!;
      const nombreTool = llamada.name ?? "";
      const argumentos = (llamada.args ?? {}) as Record<string, unknown>;

      logger.info({ chat_id: chatId, tool: nombreTool, argumentos }, "Gemini solicitó una tool call");

      if (clasificarToolCall(nombreTool, argumentos) === "irreversible") {
        const contentsCapturados = contents;
        const resumenAccion = resumirAccionIrreversible(nombreTool, argumentos);

        logger.info({ chat_id: chatId, tool: nombreTool }, "Tool irreversible: se pide confirmación antes de ejecutar");

        await confirmador.solicitarConfirmacion(chatId, resumenAccion, async () => {
          const resultado = await deps.mcpToolExecutor.ejecutarTool(pat, nombreTool, argumentos);
          const contentsConResultado = agregarResultadoTool(contentsCapturados, nombreTool, argumentos, resultado);
          const siguiente = await ejecutarRondas(chatId, pat, systemInstruction, tools, contentsConResultado, ronda + 1);

          if (siguiente === null) {
            // Otra tool irreversible en la misma cadena: ya se pidió una
            // nueva confirmación de forma recursiva, no hay nada más que
            // hacer en este nivel.
            return;
          }

          const textoFinal = siguiente ?? MENSAJE_SIN_RESPUESTA_FINAL;
          await enviarMensaje(chatId, textoFinal);
          await guardarMensajeSeguro(deps.historyStore, chatId, {
            rol: "model",
            contenido: textoFinal,
            timestamp: ahora().toISOString(),
          });
        });

        return null;
      }

      const resultado = await deps.mcpToolExecutor.ejecutarTool(pat, nombreTool, argumentos);

      logger.info(
        { chat_id: chatId, tool: nombreTool, es_error: resultado.esError },
        "Resultado de la tool call del MCP",
      );

      contents = agregarResultadoTool(contents, nombreTool, argumentos, resultado);
    }

    return undefined;
  }

  return {
    async procesarMensaje(chatId, mensajeUsuario) {
      const { pat } = await deps.credentialResolver.getUserCredentials(chatId);

      const [historial, toolsMcp] = await Promise.all([
        obtenerHistorialSeguro(deps.historyStore, chatId),
        deps.mcpToolExecutor.listarTools(pat),
      ]);

      const systemInstruction = construirSystemPrompt(ahora());
      const tools = adaptarToolsDeMcpAGemini(toolsMcp);
      const contents: Content[] = construirContents(historial, mensajeUsuario);

      logger.info({ chat_id: chatId, mensaje: mensajeUsuario }, "Mensaje del usuario recibido para Gemini");

      const resultado = await ejecutarRondas(chatId, pat, systemInstruction, tools, contents, 0);

      if (resultado === null) {
        // AC #6 (5.14): el mensaje del usuario no se pierde mientras la
        // confirmación queda pendiente, aunque tarde en resolverse.
        await guardarMensajeSeguro(deps.historyStore, chatId, {
          rol: "user",
          contenido: mensajeUsuario,
          timestamp: ahora().toISOString(),
        });
        return null;
      }

      const textoFinal = resultado ?? MENSAJE_SIN_RESPUESTA_FINAL;

      await guardarMensajeSeguro(deps.historyStore, chatId, {
        rol: "user",
        contenido: mensajeUsuario,
        timestamp: ahora().toISOString(),
      });
      await guardarMensajeSeguro(deps.historyStore, chatId, {
        rol: "model",
        contenido: textoFinal,
        timestamp: ahora().toISOString(),
      });

      return textoFinal;
    },
  };
}
