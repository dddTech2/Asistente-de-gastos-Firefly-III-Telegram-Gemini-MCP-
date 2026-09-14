import { describe, expect, it } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { extraerUsoTokens } from "../../src/gemini/usoTokens.js";

function respuesta(usageMetadata?: Record<string, unknown>): GenerateContentResponse {
  return { usageMetadata } as unknown as GenerateContentResponse;
}

describe("extraerUsoTokens (historia 8.7)", () => {
  it("devuelve undefined si la respuesta no trae usageMetadata", () => {
    expect(extraerUsoTokens(respuesta(undefined))).toBeUndefined();
  });

  it("mapea los 6 campos de usageMetadata a la forma persistida", () => {
    const uso = extraerUsoTokens(
      respuesta({
        promptTokenCount: 120,
        candidatesTokenCount: 40,
        thoughtsTokenCount: 15,
        toolUsePromptTokenCount: 8,
        cachedContentTokenCount: 95,
        totalTokenCount: 183,
      }),
    );

    expect(uso).toEqual({
      promptTokens: 120,
      candidatesTokens: 40,
      thoughtsTokens: 15,
      toolTokens: 8,
      cachedTokens: 95,
      totalTokens: 183,
    });
  });

  it("default 0 en cualquier campo ausente de usageMetadata", () => {
    const uso = extraerUsoTokens(respuesta({ promptTokenCount: 50 }));

    expect(uso).toEqual({
      promptTokens: 50,
      candidatesTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    });
  });

  it("no revienta con un usageMetadata vacío", () => {
    expect(extraerUsoTokens(respuesta({}))).toEqual({
      promptTokens: 0,
      candidatesTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    });
  });
});
