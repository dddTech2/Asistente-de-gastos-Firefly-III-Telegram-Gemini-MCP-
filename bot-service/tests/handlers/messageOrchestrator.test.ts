import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { createMessageOrchestrator, type MessageOrchestratorDeps } from "../../src/handlers/messageOrchestrator.js";
import type { HistorialMensaje } from "../../src/conversation/historyStore.js";
import { logger } from "../../src/lib/logger.js";

const CHAT_ID = 999;
const PAT = "pat-de-prueba";
const FECHA_FIJA = new Date("2026-09-13T12:00:00.000Z");

function respuestaTexto(texto: string, usageMetadata?: Record<string, unknown>): GenerateContentResponse {
  return { functionCalls: undefined, text: texto, usageMetadata } as unknown as GenerateContentResponse;
}

function respuestaConFunctionCall(
  name: string,
  args: Record<string, unknown>,
  thoughtSignature?: string,
  usageMetadata?: Record<string, unknown>,
): GenerateContentResponse {
  const parte: Record<string, unknown> = { functionCall: { name, args } };
  if (thoughtSignature !== undefined) {
    parte.thoughtSignature = thoughtSignature;
  }
  return {
    functionCalls: [{ name, args }],
    text: undefined,
    candidates: [{ content: { role: "model", parts: [parte] } }],
    usageMetadata,
  } as unknown as GenerateContentResponse;
}

function buildDeps(overrides: Partial<MessageOrchestratorDeps> = {}): {
  deps: MessageOrchestratorDeps;
  generarRespuesta: ReturnType<typeof vi.fn>;
  ejecutarTool: ReturnType<typeof vi.fn>;
  listarTools: ReturnType<typeof vi.fn>;
  getRecentMessages: ReturnType<typeof vi.fn>;
  appendMessage: ReturnType<typeof vi.fn>;
  getUserCredentials: ReturnType<typeof vi.fn>;
} {
  const generarRespuesta = vi.fn();
  const ejecutarTool = vi.fn();
  const listarTools = vi.fn().mockResolvedValue([]);
  const getRecentMessages = vi.fn().mockResolvedValue([] as HistorialMensaje[]);
  const appendMessage = vi.fn().mockResolvedValue(undefined);
  const getUserCredentials = vi.fn().mockResolvedValue({ pat: PAT });

  const deps: MessageOrchestratorDeps = {
    geminiClient: { generarRespuesta },
    mcpToolExecutor: { listarTools, ejecutarTool },
    historyStore: { getRecentMessages, appendMessage },
    credentialResolver: { getUserCredentials },
    ahora: () => FECHA_FIJA,
    ...overrides,
  };

  return { deps, generarRespuesta, ejecutarTool, listarTools, getRecentMessages, appendMessage, getUserCredentials };
}

/** Historia 5.14: helpers para las pruebas de confirmación de acciones irreversibles. */
function buildConfirmador(): { solicitarConfirmacion: ReturnType<typeof vi.fn> } {
  return { solicitarConfirmacion: vi.fn().mockResolvedValue(undefined) };
}

describe("messageOrchestrator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("cuando Gemini responde directo con texto, no ejecuta ninguna tool (AC #4)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta.mockResolvedValue(respuestaTexto("Este mes gastaste 50000 en total."));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "cuánto gasté este mes?");

    expect(resultado).toBe("Este mes gastaste 50000 en total.");
    expect(ejecutarTool).not.toHaveBeenCalled();
  });

  it("ciclo completo: functionCall -> ejecución MCP -> respuesta final (AC #3)", async () => {
    const { deps, generarRespuesta, ejecutarTool, getUserCredentials } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_accounts", {}))
      .mockResolvedValueOnce(respuestaTexto("Tenés una cuenta 'test' con balance -60000 EUR."));
    ejecutarTool.mockResolvedValue({ contenido: '{"data":[{"name":"test"}]}', esError: false });

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "qué cuentas tengo?");

    expect(getUserCredentials).toHaveBeenCalledWith(CHAT_ID);
    expect(ejecutarTool).toHaveBeenCalledWith(PAT, "get_accounts", {});
    expect(resultado).toBe("Tenés una cuenta 'test' con balance -60000 EUR.");
    expect(generarRespuesta).toHaveBeenCalledTimes(2);
  });

  it("reenvía el resultado de la tool a Gemini como functionResponse en la segunda llamada", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_accounts", { page: 1 }))
      .mockResolvedValueOnce(respuestaTexto("listo"));
    ejecutarTool.mockResolvedValue({ contenido: "resultado-mcp", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "qué cuentas tengo?");

    const segundaLlamada = generarRespuesta.mock.calls[1]![0] as { contents: unknown[] };
    const contents = segundaLlamada.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;

    const parteFunctionCall = contents.find((c) => c.role === "model");
    const parteFunctionResponse = contents.find((c) => c.role === "user" && c.parts[0]!.functionResponse);

    expect(parteFunctionCall!.parts[0]!.functionCall).toEqual({ name: "get_accounts", args: { page: 1 } });
    expect(parteFunctionResponse!.parts[0]!.functionResponse).toEqual({
      name: "get_accounts",
      response: { resultado: "resultado-mcp" },
    });
  });

  it("un error de tool (tool_not_found) se reenvía a Gemini sin cortar el ciclo", async () => {
    // Usa una tool conocida y reversible (`get_accounts`, historia 4.3) a
    // propósito: este test cubre un error a NIVEL MCP (`esError: true`), no
    // la clasificación irreversible/reversible por nombre de tool (eso lo
    // cubre `toolClassification.test.ts`) -- un nombre de tool inexistente
    // caería en la rama de confirmación (4.3/5.14) por el fail-safe de
    // "tool desconocida = irreversible", que no es lo que este test ejercita.
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_accounts", {}))
      .mockResolvedValueOnce(respuestaTexto("No encontré esa función, ¿podés reformular el pedido?"));
    ejecutarTool.mockResolvedValue({ contenido: "tool_not_found", esError: true });

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hacé algo raro");

    expect(resultado).toBe("No encontré esa función, ¿podés reformular el pedido?");
    const segundaLlamada = generarRespuesta.mock.calls[1]![0] as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    const parteError = segundaLlamada.contents.at(-1)!.parts[0]!.functionResponse as { response: Record<string, unknown> };
    expect(parteError.response).toEqual({ error: "tool_not_found" });
  });

  it("con historial vacío arma el prompt solo con el mensaje nuevo", async () => {
    const { deps, generarRespuesta } = buildDeps();
    generarRespuesta.mockResolvedValue(respuestaTexto("hola!"));

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "hola");

    const primeraLlamada = generarRespuesta.mock.calls[0]![0] as { contents: unknown[] };
    expect(primeraLlamada.contents).toEqual([{ role: "user", parts: [{ text: "hola" }] }]);
  });

  it("guarda el mensaje del usuario y la respuesta final en el historial", async () => {
    const { deps, appendMessage } = buildDeps();
    deps.geminiClient.generarRespuesta = vi.fn().mockResolvedValue(respuestaTexto("respuesta final"));

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "mensaje del usuario");

    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(appendMessage).toHaveBeenNthCalledWith(1, CHAT_ID, {
      rol: "user",
      contenido: "mensaje del usuario",
      timestamp: FECHA_FIJA.toISOString(),
    });
    expect(appendMessage).toHaveBeenNthCalledWith(2, CHAT_ID, {
      rol: "model",
      contenido: "respuesta final",
      timestamp: FECHA_FIJA.toISOString(),
    });
  });

  it("loggea el mensaje del usuario y cada tool call (AC #5)", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_accounts", {}))
      .mockResolvedValueOnce(respuestaTexto("listo"));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "mensaje");

    const mensajesLoggeados = infoSpy.mock.calls.map((llamada) => llamada[1]);
    expect(mensajesLoggeados).toContain("Mensaje del usuario recibido para Gemini");
    expect(mensajesLoggeados).toContain("Gemini solicitó una tool call");
    expect(mensajesLoggeados).toContain("Resultado de la tool call del MCP");
  });

  it("nunca loggea el PAT del usuario", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_accounts", {}))
      .mockResolvedValueOnce(respuestaTexto("listo"));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "mensaje");

    const textoCompleto = JSON.stringify(infoSpy.mock.calls);
    expect(textoCompleto).not.toContain(PAT);
  });

  it("si Redis falla al leer el historial, sigue funcionando sin historial previo", async () => {
    const { deps, generarRespuesta, getRecentMessages } = buildDeps();
    getRecentMessages.mockRejectedValue(new Error("ECONNREFUSED"));
    generarRespuesta.mockResolvedValue(respuestaTexto("igual respondo"));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(resultado).toBe("igual respondo");
  });

  it("si Redis falla al guardar el historial, igual devuelve la respuesta final", async () => {
    const { deps, generarRespuesta, appendMessage } = buildDeps();
    appendMessage.mockRejectedValue(new Error("ECONNREFUSED"));
    generarRespuesta.mockResolvedValue(respuestaTexto("respuesta pese al fallo de redis"));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(resultado).toBe("respuesta pese al fallo de redis");
  });

  it("preserva el thoughtSignature de Gemini en el historial reenviado (bug de producción: 400 thought_signature faltante)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_accounts", {}, "firma-opaca-123"))
      .mockResolvedValueOnce(respuestaTexto("listo"));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "qué cuentas tengo?");

    const segundaLlamada = generarRespuesta.mock.calls[1]![0] as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const parteModelo = segundaLlamada.contents.find((c) => c.role === "model");
    expect(parteModelo!.parts[0]!.thoughtSignature).toBe("firma-opaca-123");
  });

  it("si la respuesta de Gemini no trae candidates[0].content, reconstruye el functionCall a mano en vez de romper el ciclo (defensivo)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce({ functionCalls: [{ name: "get_accounts", args: {} }], text: undefined } as unknown as GenerateContentResponse)
      .mockResolvedValueOnce(respuestaTexto("listo"));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "qué cuentas tengo?");

    expect(resultado).toBe("listo");
  });

  it("corta después de un tope de rondas si Gemini nunca deja de pedir tools (guarda anti-loop)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta.mockResolvedValue(respuestaConFunctionCall("get_accounts", {}));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(typeof resultado).toBe("string");
    expect(resultado!.length).toBeGreaterThan(0);
    expect(generarRespuesta.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

describe("confirmación de acciones irreversibles (historia 5.14)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("una tool irreversible (ej. delete_transaction) pide confirmación en vez de ejecutarse (AC #1, #2)", async () => {
    const confirmador = buildConfirmador();
    const enviarMensaje = vi.fn().mockResolvedValue(undefined);
    const { deps, generarRespuesta, ejecutarTool } = buildDeps({ confirmador, enviarMensaje });
    generarRespuesta.mockResolvedValueOnce(respuestaConFunctionCall("delete_transaction", { id: "42" }));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "borrá la transacción 42");

    expect(resultado).toBeNull();
    expect(ejecutarTool).not.toHaveBeenCalled();
    expect(enviarMensaje).not.toHaveBeenCalled();
    expect(confirmador.solicitarConfirmacion).toHaveBeenCalledTimes(1);

    const [chatId, resumenAccion] = confirmador.solicitarConfirmacion.mock.calls[0]!;
    expect(chatId).toBe(CHAT_ID);
    expect(resumenAccion).not.toMatch(/[{}[\]]/);
  });

  it("una tool desconocida (fuera del catálogo de 4.2) también pide confirmación, fail-safe", async () => {
    const confirmador = buildConfirmador();
    const { deps, generarRespuesta, ejecutarTool } = buildDeps({ confirmador, enviarMensaje: vi.fn() });
    generarRespuesta.mockResolvedValueOnce(respuestaConFunctionCall("tool_del_futuro", {}));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hacé algo nuevo");

    expect(resultado).toBeNull();
    expect(ejecutarTool).not.toHaveBeenCalled();
    expect(confirmador.solicitarConfirmacion).toHaveBeenCalledTimes(1);
  });

  it("al confirmar (invocar el callback ejecutar), completa el ciclo y envía la respuesta final (AC #3)", async () => {
    const confirmador = buildConfirmador();
    const enviarMensaje = vi.fn().mockResolvedValue(undefined);
    const { deps, generarRespuesta, ejecutarTool, appendMessage } = buildDeps({ confirmador, enviarMensaje });
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("delete_transaction", { id: "42" }))
      .mockResolvedValueOnce(respuestaTexto("Listo, borré la transacción 42."));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "borrá la transacción 42");

    // Simula que el usuario tocó "Sí, confirmar": invoca el callback que
    // messageOrchestrator le pasó a confirmador.solicitarConfirmacion.
    const ejecutar = confirmador.solicitarConfirmacion.mock.calls[0]![2] as () => Promise<void>;
    await ejecutar();

    expect(ejecutarTool).toHaveBeenCalledWith(PAT, "delete_transaction", { id: "42" });
    expect(enviarMensaje).toHaveBeenCalledWith(CHAT_ID, "Listo, borré la transacción 42.");
    expect(appendMessage).toHaveBeenCalledWith(CHAT_ID, {
      rol: "model",
      contenido: "Listo, borré la transacción 42.",
      timestamp: FECHA_FIJA.toISOString(),
    });
  });

  it("una tool reversible (ej. create_transaction) sigue ejecutándose de inmediato, sin confirmar (AC #5)", async () => {
    const confirmador = buildConfirmador();
    const { deps, generarRespuesta, ejecutarTool } = buildDeps({ confirmador, enviarMensaje: vi.fn() });
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("create_transaction", { type: "withdrawal", amount: 5000 }))
      .mockResolvedValueOnce(respuestaTexto("Listo, registrado."));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "gasté 5000");

    expect(resultado).toBe("Listo, registrado.");
    expect(ejecutarTool).toHaveBeenCalledTimes(1);
    expect(confirmador.solicitarConfirmacion).not.toHaveBeenCalled();
  });

  it("el mensaje del usuario queda guardado en el historial apenas se pide la confirmación (AC #6)", async () => {
    const confirmador = buildConfirmador();
    const { deps, generarRespuesta, appendMessage } = buildDeps({ confirmador, enviarMensaje: vi.fn() });
    generarRespuesta.mockResolvedValueOnce(respuestaConFunctionCall("delete_account", { id: "3" }));

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "borrá mi cuenta Efectivo");

    expect(appendMessage).toHaveBeenCalledWith(CHAT_ID, {
      rol: "user",
      contenido: "borrá mi cuenta Efectivo",
      timestamp: FECHA_FIJA.toISOString(),
    });
  });

  it("sin `confirmador` configurado, una tool irreversible falla explícito en vez de ejecutarse sin confirmar", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta.mockResolvedValueOnce(respuestaConFunctionCall("delete_transaction", { id: "1" }));

    const orquestador = createMessageOrchestrator(deps);

    await expect(orquestador.procesarMensaje(CHAT_ID, "borrá la transacción 1")).rejects.toThrow(/confirmador/);
    expect(ejecutarTool).not.toHaveBeenCalled();
  });
});

describe("auditoría de tokens de Gemini (historia 8.7)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registra el uso de tokens de cada ronda real a Gemini (AC #2)", async () => {
    const registrarUsoTokens = vi.fn().mockResolvedValue(undefined);
    const { deps, generarRespuesta, ejecutarTool } = buildDeps({ registrarUsoTokens });
    generarRespuesta
      .mockResolvedValueOnce(
        respuestaConFunctionCall("get_accounts", {}, undefined, {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          totalTokenCount: 120,
        }),
      )
      .mockResolvedValueOnce(
        respuestaTexto("listo", { promptTokenCount: 150, candidatesTokenCount: 30, totalTokenCount: 180 }),
      );
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "qué cuentas tengo?");

    expect(registrarUsoTokens).toHaveBeenCalledTimes(2);
    expect(registrarUsoTokens).toHaveBeenNthCalledWith(1, CHAT_ID, {
      promptTokens: 100,
      candidatesTokens: 20,
      thoughtsTokens: 0,
      toolTokens: 0,
      totalTokens: 120,
    });
    expect(registrarUsoTokens).toHaveBeenNthCalledWith(2, CHAT_ID, {
      promptTokens: 150,
      candidatesTokens: 30,
      thoughtsTokens: 0,
      toolTokens: 0,
      totalTokens: 180,
    });
  });

  it("no registra nada si la respuesta de Gemini no trae usageMetadata", async () => {
    const registrarUsoTokens = vi.fn().mockResolvedValue(undefined);
    const { deps, generarRespuesta } = buildDeps({ registrarUsoTokens });
    generarRespuesta.mockResolvedValue(respuestaTexto("hola"));

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(registrarUsoTokens).not.toHaveBeenCalled();
  });

  it("un error al registrar el uso de tokens no corta el ciclo ni cambia la respuesta final (AC #3)", async () => {
    const registrarUsoTokens = vi.fn().mockRejectedValue(new Error("Postgres caído"));
    const { deps, generarRespuesta } = buildDeps({ registrarUsoTokens });
    generarRespuesta.mockResolvedValue(respuestaTexto("respuesta final", { totalTokenCount: 50 }));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(resultado).toBe("respuesta final");
    expect(registrarUsoTokens).toHaveBeenCalledTimes(1);
  });

  it("sin `registrarUsoTokens` configurado, el orquestador funciona exactamente igual que antes de esta historia", async () => {
    const { deps, generarRespuesta } = buildDeps();
    generarRespuesta.mockResolvedValue(respuestaTexto("hola", { totalTokenCount: 50 }));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(resultado).toBe("hola");
  });
});
