import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { createMessageOrchestrator, type MessageOrchestratorDeps } from "../../src/handlers/messageOrchestrator.js";
import type { HistorialMensaje } from "../../src/conversation/historyStore.js";
import { logger } from "../../src/lib/logger.js";

const CHAT_ID = 999;
const PAT = "pat-de-prueba";
const FECHA_FIJA = new Date("2026-09-13T12:00:00.000Z");

function respuestaTexto(texto: string): GenerateContentResponse {
  return { functionCalls: undefined, text: texto } as unknown as GenerateContentResponse;
}

function respuestaConFunctionCall(name: string, args: Record<string, unknown>): GenerateContentResponse {
  return { functionCalls: [{ name, args }], text: undefined } as unknown as GenerateContentResponse;
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
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("tool_inexistente", {}))
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

  it("corta después de un tope de rondas si Gemini nunca deja de pedir tools (guarda anti-loop)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta.mockResolvedValue(respuestaConFunctionCall("get_accounts", {}));
    ejecutarTool.mockResolvedValue({ contenido: "ok", esError: false });

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "hola");

    expect(typeof resultado).toBe("string");
    expect(resultado.length).toBeGreaterThan(0);
    expect(generarRespuesta.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
