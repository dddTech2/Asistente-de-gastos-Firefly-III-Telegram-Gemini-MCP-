import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionDeclaration, GenerateContentResponse } from "@google/genai";
import { createGeminiClient, type ClienteGeminiSdk } from "../../src/gemini/geminiClient.js";
import { logger } from "../../src/lib/logger.js";

const TOOL_A: FunctionDeclaration[] = [{ name: "get_accounts", description: "", parametersJsonSchema: {} }];
const TOOL_B: FunctionDeclaration[] = [{ name: "get_categories", description: "", parametersJsonSchema: {} }];

function respuestaFake(): GenerateContentResponse {
  return { text: "ok" } as unknown as GenerateContentResponse;
}

function buildAiFake(): { ai: ClienteGeminiSdk; generateContent: ReturnType<typeof vi.fn>; cachesCreate: ReturnType<typeof vi.fn> } {
  const generateContent = vi.fn().mockResolvedValue(respuestaFake());
  const cachesCreate = vi.fn().mockResolvedValue({ name: "cachedContents/abc123" });
  const ai: ClienteGeminiSdk = {
    models: { generateContent },
    caches: { create: cachesCreate },
  };
  return { ai, generateContent, cachesCreate };
}

describe("createGeminiClient -- cache de tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("en la primera llamada con tools, crea un cache y lo referencia via cachedContent", async () => {
    const { ai, generateContent, cachesCreate } = buildAiFake();
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", { ai });

    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });

    expect(cachesCreate).toHaveBeenCalledTimes(1);
    expect(cachesCreate).toHaveBeenCalledWith({
      model: "gemini-flash-latest",
      config: { tools: [{ functionDeclarations: TOOL_A }], ttl: "3600s" },
    });
    const [args] = generateContent.mock.calls[0]!;
    expect(args.config.cachedContent).toBe("cachedContents/abc123");
    expect(args.config.tools).toBeUndefined();
  });

  it("con las mismas tools, reusa el cache en vez de crear uno nuevo", async () => {
    const { ai, cachesCreate } = buildAiFake();
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", { ai });

    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });
    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });
    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });

    expect(cachesCreate).toHaveBeenCalledTimes(1);
  });

  it("si las tools cambian, crea un cache nuevo", async () => {
    const { ai, cachesCreate, generateContent } = buildAiFake();
    cachesCreate
      .mockResolvedValueOnce({ name: "cachedContents/tools-a" })
      .mockResolvedValueOnce({ name: "cachedContents/tools-b" });
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", { ai });

    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });
    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_B });

    expect(cachesCreate).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]![0].config.cachedContent).toBe("cachedContents/tools-a");
    expect(generateContent.mock.calls[1]![0].config.cachedContent).toBe("cachedContents/tools-b");
  });

  it("con tools vacío, nunca crea ni usa cache (llamada final forzada del fix de ronda agotada)", async () => {
    const { ai, cachesCreate, generateContent } = buildAiFake();
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", { ai });

    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: [] });

    expect(cachesCreate).not.toHaveBeenCalled();
    const [args] = generateContent.mock.calls[0]!;
    expect(args.config.cachedContent).toBeUndefined();
    expect(args.config.tools).toBeUndefined();
  });

  it("CRITICO: aunque haya un cache válido de una llamada anterior, una llamada con tools vacío nunca lo reutiliza", async () => {
    const { ai, generateContent } = buildAiFake();
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", { ai });

    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });
    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: [] });

    const [argsSegundaLlamada] = generateContent.mock.calls[1]!;
    expect(argsSegundaLlamada.config.cachedContent).toBeUndefined();
    expect(argsSegundaLlamada.config.tools).toBeUndefined();
  });

  it("si caches.create falla, cae a enviar las tools directo sin cachear (fail-safe, no revienta)", async () => {
    const { ai, cachesCreate, generateContent } = buildAiFake();
    cachesCreate.mockRejectedValue(new Error("modelo sin soporte de caching"));
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", { ai });

    const respuesta = await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });

    expect(respuesta.text).toBe("ok");
    const [args] = generateContent.mock.calls[0]!;
    expect(args.config.cachedContent).toBeUndefined();
    expect(args.config.tools).toEqual([{ functionDeclarations: TOOL_A }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("renueva el cache una vez vencido el TTL", async () => {
    const { ai, cachesCreate } = buildAiFake();
    cachesCreate
      .mockResolvedValueOnce({ name: "cachedContents/primero" })
      .mockResolvedValueOnce({ name: "cachedContents/segundo" });
    let ahoraMs = 0;
    const cliente = createGeminiClient("api-key", "gemini-flash-latest", {
      ai,
      ahora: () => ahoraMs,
      ttlCacheSegundos: 60,
    });

    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });
    ahoraMs += 61 * 1000; // pasó el TTL (60s)
    await cliente.generarRespuesta({ systemInstruction: "sys", contents: [], tools: TOOL_A });

    expect(cachesCreate).toHaveBeenCalledTimes(2);
  });
});
