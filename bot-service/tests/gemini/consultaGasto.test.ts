import { describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { construirSystemPrompt } from "../../src/gemini/promptBuilder.js";
import { FRAGMENTO_PROMPT_CONSULTA_GASTO } from "../../src/gemini/prompts/consultaGasto.prompt.js";
import { resolverRangoFechas } from "../../src/gemini/dateRangeResolver.js";
import { createMessageOrchestrator, type MessageOrchestratorDeps } from "../../src/handlers/messageOrchestrator.js";
import type { HistorialMensaje } from "../../src/conversation/historyStore.js";

const FECHA_FIJA = new Date("2026-09-13T12:00:00.000Z");

describe("fragmento de prompt de consulta de gasto (AC #1, #2)", () => {
  it("documenta las cuatro expresiones de tiempo relativas citadas en el AC #2", () => {
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("hoy");
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("la semana pasada");
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("este mes");
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("este año");
  });

  it("nombra las tools de consulta reales del catálogo (4.2) para categoría y para período", () => {
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("get_categories");
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("get_category_transactions");
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO).toContain("get_transactions");
  });

  it("documenta el comportamiento por defecto ante una expresión de tiempo ambigua (Testing, edge case)", () => {
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO.toLowerCase()).toContain('asumí "este mes" por defecto');
  });

  it("instruye responder con claridad cuando no hay resultados, sin tratarlo como error (AC #4)", () => {
    expect(FRAGMENTO_PROMPT_CONSULTA_GASTO.toLowerCase()).toContain("no es un error");
  });

  it("está incluido en el system prompt armado por promptBuilder", () => {
    const prompt = construirSystemPrompt(FECHA_FIJA);
    expect(prompt).toContain(FRAGMENTO_PROMPT_CONSULTA_GASTO);
  });
});

function buildDeps(overrides: Partial<MessageOrchestratorDeps> = {}): {
  deps: MessageOrchestratorDeps;
  generarRespuesta: ReturnType<typeof vi.fn>;
  ejecutarTool: ReturnType<typeof vi.fn>;
} {
  const generarRespuesta = vi.fn();
  const ejecutarTool = vi.fn().mockResolvedValue({ contenido: "{}", esError: false });

  const deps: MessageOrchestratorDeps = {
    geminiClient: { generarRespuesta },
    mcpToolExecutor: { listarTools: vi.fn().mockResolvedValue([]), ejecutarTool },
    historyStore: {
      getRecentMessages: vi.fn().mockResolvedValue([] as HistorialMensaje[]),
      appendMessage: vi.fn().mockResolvedValue(undefined),
    },
    credentialResolver: { getUserCredentials: vi.fn().mockResolvedValue({ pat: "pat-de-prueba" }) },
    ahora: () => FECHA_FIJA,
    ...overrides,
  };

  return { deps, generarRespuesta, ejecutarTool };
}

function respuestaConFunctionCall(nombre: string, args: Record<string, unknown>): GenerateContentResponse {
  return { functionCalls: [{ name: nombre, args }], text: undefined } as unknown as GenerateContentResponse;
}

function respuestaTexto(texto: string): GenerateContentResponse {
  return { functionCalls: undefined, text: texto } as unknown as GenerateContentResponse;
}

describe("consulta de gasto con categoría + período (AC #1, #2, #3)", () => {
  it("«¿cuánto llevo gastado en comida este mes?» resuelve la categoría y consulta el rango de 'este mes'", async () => {
    const rango = resolverRangoFechas("este mes", FECHA_FIJA)!;
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();

    ejecutarTool.mockResolvedValueOnce({
      contenido: JSON.stringify({ data: [{ id: "7", attributes: { name: "Comida" } }] }),
      esError: false,
    });
    ejecutarTool.mockResolvedValueOnce({
      contenido: JSON.stringify({ data: [{ attributes: { transactions: [{ amount: "20000", currency_code: "ARS" }] } }] }),
      esError: false,
    });

    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall("get_categories", {}))
      .mockResolvedValueOnce(
        respuestaConFunctionCall("get_category_transactions", {
          category_id: "7",
          start: rango.desde,
          end: rango.hasta,
        }),
      )
      .mockResolvedValueOnce(respuestaTexto("Gastaste 20.000 ARS en Comida este mes."));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(321, "¿cuánto llevo gastado en comida este mes?");

    expect(ejecutarTool).toHaveBeenCalledTimes(2);
    expect(ejecutarTool).toHaveBeenNthCalledWith(1, "pat-de-prueba", "get_categories", {});
    expect(ejecutarTool).toHaveBeenNthCalledWith(2, "pat-de-prueba", "get_category_transactions", {
      category_id: "7",
      start: rango.desde,
      end: rango.hasta,
    });
    expect(resultado).toBe("Gastaste 20.000 ARS en Comida este mes.");
  });
});

describe("consulta de gasto solo por período, sin categoría (AC #1, #2, #3)", () => {
  it("«¿cuánto gasté hoy?» consulta directo por período, sin pasar por get_categories", async () => {
    const rango = resolverRangoFechas("hoy", FECHA_FIJA)!;
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();

    generarRespuesta
      .mockResolvedValueOnce(
        respuestaConFunctionCall("get_transactions", { type: "withdrawal", start: rango.desde, end: rango.hasta }),
      )
      .mockResolvedValueOnce(respuestaTexto("Hoy gastaste 3.500 ARS."));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(321, "¿cuánto gasté hoy?");

    expect(ejecutarTool).toHaveBeenCalledTimes(1);
    expect(ejecutarTool).toHaveBeenCalledWith("pat-de-prueba", "get_transactions", {
      type: "withdrawal",
      start: rango.desde,
      end: rango.hasta,
    });
    expect(resultado).toBe("Hoy gastaste 3.500 ARS.");
  });
});

describe("consulta de gasto sin resultados (AC #4)", () => {
  it("sin transacciones en el período, responde con claridad y no lo trata como error", async () => {
    const rango = resolverRangoFechas("la semana pasada", FECHA_FIJA)!;
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();

    ejecutarTool.mockResolvedValueOnce({ contenido: JSON.stringify({ data: [] }), esError: false });
    generarRespuesta
      .mockResolvedValueOnce(
        respuestaConFunctionCall("get_transactions", { type: "withdrawal", start: rango.desde, end: rango.hasta }),
      )
      .mockResolvedValueOnce(respuestaTexto("No registrás gastos la semana pasada."));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(321, "¿qué gasté la semana pasada?");

    expect(resultado).toBe("No registrás gastos la semana pasada.");
    expect(resultado.toLowerCase()).not.toContain("error");
  });
});

describe("consulta de gasto — aislamiento por PAT propio (AC #5)", () => {
  it("cada chat_id consulta con su propio PAT, sin mezclar credenciales entre usuarios", async () => {
    const rango = resolverRangoFechas("hoy", FECHA_FIJA)!;
    const getUserCredentials = vi.fn(async (chatId: number) => ({ pat: `pat-usuario-${chatId}` }));
    const { deps, generarRespuesta, ejecutarTool } = buildDeps({ credentialResolver: { getUserCredentials } });

    generarRespuesta
      .mockResolvedValueOnce(
        respuestaConFunctionCall("get_transactions", { type: "withdrawal", start: rango.desde, end: rango.hasta }),
      )
      .mockResolvedValueOnce(respuestaTexto("Hoy gastaste 1.000 ARS."))
      .mockResolvedValueOnce(
        respuestaConFunctionCall("get_transactions", { type: "withdrawal", start: rango.desde, end: rango.hasta }),
      )
      .mockResolvedValueOnce(respuestaTexto("Hoy gastaste 2.000 ARS."));

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(111, "¿cuánto gasté hoy?");
    await orquestador.procesarMensaje(222, "¿cuánto gasté hoy?");

    expect(ejecutarTool).toHaveBeenNthCalledWith(1, "pat-usuario-111", "get_transactions", expect.any(Object));
    expect(ejecutarTool).toHaveBeenNthCalledWith(2, "pat-usuario-222", "get_transactions", expect.any(Object));
  });
});
