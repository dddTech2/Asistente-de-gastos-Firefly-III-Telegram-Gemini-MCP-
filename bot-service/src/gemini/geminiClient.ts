import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentResponse } from "@google/genai";

/**
 * Alias que Google mantiene apuntando al Flash más reciente -- se usa el
 * alias en vez de fijar una versión puntual. [Source:
 * docs/plan/backlog-plan-implementacion.md#1-stack-tecnológico-recomendado]
 */
export const MODELO_GEMINI_DEFAULT = "gemini-flash-latest";

export interface GeminiClient {
  generarRespuesta(params: {
    systemInstruction: string;
    contents: Content[];
    tools: FunctionDeclaration[];
  }): Promise<GenerateContentResponse>;
}

/**
 * AC #1: wrapper delgado del SDK de Gemini (`@google/genai`) con function
 * calling habilitado. Sin lógica propia de reintentos/backoff -- eso es de
 * la Épica 6 (HU-26), que debe poder envolver este punto de entrada sin
 * tocar el resto del pipeline. [Source: bmad-output/stories/5.1.prompt-tools-gemini.story.md#dev-notes]
 */
export function createGeminiClient(apiKey: string, modelo: string = MODELO_GEMINI_DEFAULT): GeminiClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generarRespuesta({ systemInstruction, contents, tools }) {
      return ai.models.generateContent({
        model: modelo,
        contents,
        config: {
          systemInstruction,
          ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
        },
      });
    },
  };
}
