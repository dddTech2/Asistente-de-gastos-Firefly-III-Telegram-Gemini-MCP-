import { describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { construirSystemPrompt } from "../../src/gemini/promptBuilder.js";
import { FRAGMENTO_PROMPT_REGISTRO_GASTO } from "../../src/gemini/prompts/registroGasto.prompt.js";
import { createMessageOrchestrator, type MessageOrchestratorDeps } from "../../src/handlers/messageOrchestrator.js";
import type { HistorialMensaje } from "../../src/conversation/historyStore.js";

const PAT = "pat-de-prueba";
const CHAT_ID = 321;
const FECHA_FIJA = new Date("2026-09-13T12:00:00.000Z");

describe("fragmento de prompt de registro de gasto (AC #1, #2)", () => {
  it("cubre los cuatro formatos coloquiales de monto citados en el AC #2", () => {
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO).toContain("20 mil");
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO).toContain("20k");
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO).toContain("$20.000");
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO).toContain("20.000 pesos");
  });

  it("instruye siempre 'withdrawal' para un gasto, mencionando explícitamente que deposit/transfer están descartados", () => {
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO).toContain('"withdrawal"');
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO).toContain('nunca `"deposit"` ni `"transfer"`');
  });

  it("instruye no inventar cuenta/categoría cuando el usuario no las menciona (AC #3)", () => {
    expect(FRAGMENTO_PROMPT_REGISTRO_GASTO.toLowerCase()).toContain("no incluyas");
  });

  it("está incluido en el system prompt armado por promptBuilder", () => {
    const prompt = construirSystemPrompt(FECHA_FIJA);
    expect(prompt).toContain(FRAGMENTO_PROMPT_REGISTRO_GASTO);
  });
});

/**
 * Tabla de fixtures (AC #1, #2, #3, #5): dado que Gemini interpretó
 * correctamente la frase según el fragmento de arriba, ¿el resto del
 * pipeline (armado en la historia 5.1) ejecuta y responde bien? No se llama
 * a Gemini real -- se simula la interpretación esperada por fixture, tal
 * como especifica el Testing (LOCKED) de esta historia.
 */
interface FixtureRegistro {
  frase: string;
  argumentosEsperados: Record<string, unknown>;
}

const FIXTURES: FixtureRegistro[] = [
  {
    frase: "gasté 20 mil en almuerzo",
    argumentosEsperados: { type: "withdrawal", amount: 20000, description: "almuerzo" },
  },
  {
    frase: "20k en el super",
    argumentosEsperados: { type: "withdrawal", amount: 20000, description: "super" },
  },
  {
    frase: "gasté $20.000 en el super",
    argumentosEsperados: { type: "withdrawal", amount: 20000, description: "super" },
  },
  {
    frase: "pagué 20.000 pesos de transporte",
    argumentosEsperados: { type: "withdrawal", amount: 20000, description: "transporte" },
  },
  {
    frase: "pagué 15.000 de transporte ayer",
    argumentosEsperados: {
      type: "withdrawal",
      amount: 15000,
      description: "transporte",
      date: "2026-09-12",
    },
  },
];

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
    credentialResolver: { getUserCredentials: vi.fn().mockResolvedValue({ pat: PAT }) },
    ahora: () => FECHA_FIJA,
    ...overrides,
  };

  return { deps, generarRespuesta, ejecutarTool };
}

function respuestaConFunctionCall(args: Record<string, unknown>): GenerateContentResponse {
  return {
    functionCalls: [{ name: "create_transaction", args }],
    text: undefined,
  } as unknown as GenerateContentResponse;
}

function respuestaTexto(texto: string): GenerateContentResponse {
  return { functionCalls: undefined, text: texto } as unknown as GenerateContentResponse;
}

describe("registro de gasto vía lenguaje natural — tabla de fixtures (AC #1, #2, #5)", () => {
  it.each(FIXTURES)("«$frase» produce la tool call esperada", async ({ frase, argumentosEsperados }) => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall(argumentosEsperados))
      .mockResolvedValueOnce(respuestaTexto("listo, lo registré"));

    const orquestador = createMessageOrchestrator(deps);
    await orquestador.procesarMensaje(CHAT_ID, frase);

    expect(ejecutarTool).toHaveBeenCalledWith(PAT, "create_transaction", argumentosEsperados);
    const [, , argumentosRecibidos] = ejecutarTool.mock.calls[0]!;
    expect((argumentosRecibidos as { type: string }).type).toBe("withdrawal");
  });
});

describe("registro de gasto — casos sin cuenta/categoría (AC #3)", () => {
  it("sin cuenta ni categoría, igual ejecuta la tool y responde (no bloquea por datos opcionales)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    const argumentos = { type: "withdrawal", amount: 5000, description: "café" };
    generarRespuesta
      .mockResolvedValueOnce(respuestaConFunctionCall(argumentos))
      .mockResolvedValueOnce(respuestaTexto("Listo, registré 5000 en café."));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "gasté 5000 en café");

    expect(ejecutarTool).toHaveBeenCalledTimes(1);
    expect(resultado).toBe("Listo, registré 5000 en café.");
  });
});

describe("registro de gasto — edge cases del Testing (monto ambiguo)", () => {
  it("con un monto ambiguo/ausente, no llama a la tool y no crashea (la desambiguación formal es de 5.4)", async () => {
    const { deps, generarRespuesta, ejecutarTool } = buildDeps();
    generarRespuesta.mockResolvedValueOnce(respuestaTexto("¿Cuánto gastaste exactamente?"));

    const orquestador = createMessageOrchestrator(deps);
    const resultado = await orquestador.procesarMensaje(CHAT_ID, "gasté algo en el super");

    expect(ejecutarTool).not.toHaveBeenCalled();
    expect(resultado).toBe("¿Cuánto gastaste exactamente?");
  });
});
