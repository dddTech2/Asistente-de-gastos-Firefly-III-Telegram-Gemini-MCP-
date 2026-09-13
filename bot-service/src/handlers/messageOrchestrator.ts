import type { Content } from "@google/genai";
import type { GeminiClient } from "../gemini/geminiClient.js";
import { construirContents, construirSystemPrompt } from "../gemini/promptBuilder.js";
import { adaptarToolsDeMcpAGemini } from "../gemini/toolDeclarationsAdapter.js";
import type { McpToolExecutor } from "../mcp/mcpToolExecutor.js";
import type { HistorialMensaje, HistoryStore } from "../conversation/historyStore.js";
import { logger } from "../lib/logger.js";

export interface CredentialResolverParaOrquestador {
  getUserCredentials(chatId: number): Promise<{ pat: string }>;
}

export interface MessageOrchestratorDeps {
  geminiClient: GeminiClient;
  mcpToolExecutor: McpToolExecutor;
  historyStore: HistoryStore;
  credentialResolver: CredentialResolverParaOrquestador;
  /** Inyectable para tests -- default `() => new Date()`. */
  ahora?: () => Date;
}

export interface MessageOrchestrator {
  procesarMensaje(chatId: number, mensajeUsuario: string): Promise<string>;
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

/**
 * AC #1, #3, #4 (historia 5.1): orquesta el ciclo completo -- arma el prompt
 * (system + historial + tools), llama a Gemini, y si responde con un
 * `functionCall` ejecuta la tool contra el MCP y reenvía el resultado a
 * Gemini para la respuesta final; si responde directo con texto, no llama a
 * ninguna tool.
 *
 * `toolClassification.ts`/`confirmacionAccionIrreversible.ts` (historia 4.3)
 * TODAVÍA NO se invocan acá: ningún AC ni escenario del Testing de esta
 * historia pide confirmar antes de ejecutar una tool irreversible, y hacerlo
 * cambiaría el ciclo de síncrono a uno que debe pausarse a esperar un botón
 * -- eso queda pendiente para cuando una historia posterior (candidata
 * natural: 5.4, que ya trata rutas de tool-call inválida/ambigua) lo pida
 * explícitamente. Ver `mcp/README.md#historia-4.3` para el contrato ya
 * documentado que esa futura integración debe seguir.
 */
export function createMessageOrchestrator(deps: MessageOrchestratorDeps): MessageOrchestrator {
  const ahora = deps.ahora ?? (() => new Date());

  return {
    async procesarMensaje(chatId, mensajeUsuario) {
      const { pat } = await deps.credentialResolver.getUserCredentials(chatId);

      const [historial, toolsMcp] = await Promise.all([
        obtenerHistorialSeguro(deps.historyStore, chatId),
        deps.mcpToolExecutor.listarTools(pat),
      ]);

      const systemInstruction = construirSystemPrompt(ahora());
      const tools = adaptarToolsDeMcpAGemini(toolsMcp);
      let contents: Content[] = construirContents(historial, mensajeUsuario);

      logger.info({ chat_id: chatId, mensaje: mensajeUsuario }, "Mensaje del usuario recibido para Gemini");

      let respuestaFinal: string | undefined;

      for (let ronda = 0; ronda < MAX_RONDAS_TOOL_CALL; ronda++) {
        const respuesta = await deps.geminiClient.generarRespuesta({ systemInstruction, contents, tools });
        const functionCalls = respuesta.functionCalls;

        if (!functionCalls || functionCalls.length === 0) {
          respuestaFinal = respuesta.text ?? "";
          break;
        }

        const llamada = functionCalls[0]!;
        const nombreTool = llamada.name ?? "";
        const argumentos = (llamada.args ?? {}) as Record<string, unknown>;

        logger.info({ chat_id: chatId, tool: nombreTool, argumentos }, "Gemini solicitó una tool call");

        const resultado = await deps.mcpToolExecutor.ejecutarTool(pat, nombreTool, argumentos);

        logger.info(
          { chat_id: chatId, tool: nombreTool, es_error: resultado.esError },
          "Resultado de la tool call del MCP",
        );

        contents = [
          ...contents,
          { role: "model", parts: [{ functionCall: { name: nombreTool, args: argumentos } }] },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: nombreTool,
                  response: resultado.esError
                    ? { error: resultado.contenido }
                    : { resultado: resultado.contenido },
                },
              },
            ],
          },
        ];
      }

      const textoFinal = respuestaFinal ?? MENSAJE_SIN_RESPUESTA_FINAL;

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
