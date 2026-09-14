import type { GenerateContentResponse } from "@google/genai";

export interface UsoTokensGemini {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  toolTokens: number;
  totalTokens: number;
}

/**
 * `respuesta.usageMetadata` (historia 8.7): el SDK lo devuelve en cada
 * llamada real a Gemini, pero el resto del código nunca lo leyó hasta esta
 * historia (mismo hallazgo que el `thoughtSignature` del bug de producción
 * resuelto en la misma sesión -- `GenerateContentResponse` trae más campos de
 * los que `messageOrchestrator.ts` históricamente usaba). `undefined` cuando
 * la respuesta no trae metadata de uso -- no hay nada que registrar.
 */
export function extraerUsoTokens(respuesta: GenerateContentResponse): UsoTokensGemini | undefined {
  const meta = respuesta.usageMetadata;
  if (!meta) {
    return undefined;
  }

  return {
    promptTokens: meta.promptTokenCount ?? 0,
    candidatesTokens: meta.candidatesTokenCount ?? 0,
    thoughtsTokens: meta.thoughtsTokenCount ?? 0,
    toolTokens: meta.toolUsePromptTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0,
  };
}
