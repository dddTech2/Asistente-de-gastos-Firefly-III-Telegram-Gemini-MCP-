import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentResponse } from "@google/genai";
import { logger } from "../lib/logger.js";

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
 * Subconjunto del SDK real que este módulo necesita -- permite inyectar un
 * fake en tests sin pegarle a la API de Gemini de verdad, mismo criterio que
 * `ahora` en `messageOrchestrator.ts`.
 */
export interface ClienteGeminiSdk {
  models: Pick<GoogleGenAI["models"], "generateContent">;
  caches: Pick<GoogleGenAI["caches"], "create">;
}

export interface GeminiClientOpciones {
  /** Inyectable para tests -- default: cliente real de `@google/genai`. */
  ai?: ClienteGeminiSdk;
  /** Inyectable para tests -- default `() => Date.now()`. */
  ahora?: () => number;
  /** TTL del cache de tools, en segundos -- default 1h. */
  ttlCacheSegundos?: number;
}

const TTL_CACHE_SEGUNDOS_DEFAULT = 3600;
/**
 * Margen de seguridad para renovar el cache ANTES de que Gemini lo expire de
 * verdad del lado del servidor -- evita una carrera donde el cache vence a
 * mitad de una request en curso.
 */
const MARGEN_EXPIRACION_MS = 60_000;

interface CacheDeTools {
  nombre: string;
  huella: string;
  expiraEn: number;
}

/**
 * Optimización de costo (no pedida por ningún AC, ver decision-log.md): el
 * catálogo de tools del MCP de Firefly III (140 tools, ~20-25K tokens de JSON
 * Schema) es IDÉNTICO entre usuarios -- no depende del PAT, solo de qué tools
 * existe -- y entre las N rondas del mismo ciclo de tool-calling
 * (`messageOrchestrator.ejecutarRondas` reusa el mismo `tools` en todas). Es
 * el candidato perfecto para el context caching explícito de Gemini
 * (`ai.caches.create`), que cobra los tokens cacheados a una fracción del
 * precio normal de entrada.
 *
 * Se cachea SOLO `tools`, nunca `systemInstruction`: `systemInstruction`
 * cambia de contenido en cada llamada porque `construirSystemPrompt` inyecta
 * la fecha/hora actual -- cachearlo requeriría separar esa parte dinámica del
 * resto, un cambio de mayor alcance que queda fuera de esta optimización
 * puntual (y el system prompt, unos pocos párrafos, es una fracción mínima
 * del costo real frente a las 140 tools).
 *
 * CRÍTICO: cuando `tools` viene vacío (`[]` -- la llamada final forzada sin
 * tools del fix de "no pude terminar tu pedido" en `messageOrchestrator.ts`)
 * nunca se usa ni se crea cache. Si acá se reusara el cache de una llamada
 * anterior, Gemini volvería a tener tools disponibles pese a que esa llamada
 * existe justamente para que NO pueda pedir ninguna -- deshaciendo ese fix.
 *
 * Fail-safe: si crear/renovar el cache falla (modelo sin soporte, umbral
 * mínimo de tokens no alcanzado, etc.), se loguea un warning y se sigue
 * enviando el catálogo completo sin cachear -- nunca se corta la respuesta al
 * usuario por esto.
 */
export function createGeminiClient(
  apiKey: string,
  modelo: string = MODELO_GEMINI_DEFAULT,
  opciones: GeminiClientOpciones = {},
): GeminiClient {
  const ai: ClienteGeminiSdk = opciones.ai ?? new GoogleGenAI({ apiKey });
  const ahora = opciones.ahora ?? (() => Date.now());
  const ttlCacheSegundos = opciones.ttlCacheSegundos ?? TTL_CACHE_SEGUNDOS_DEFAULT;

  let cache: CacheDeTools | null = null;

  async function obtenerCacheDeTools(tools: FunctionDeclaration[]): Promise<string | undefined> {
    if (tools.length === 0) {
      return undefined;
    }

    const huella = JSON.stringify(tools);
    const ahoraMs = ahora();

    if (cache && cache.huella === huella && cache.expiraEn > ahoraMs) {
      return cache.nombre;
    }

    try {
      const creado = await ai.caches.create({
        model: modelo,
        config: { tools: [{ functionDeclarations: tools }], ttl: `${ttlCacheSegundos}s` },
      });
      if (!creado.name) {
        throw new Error("Gemini no devolvió un nombre de cache en la respuesta de caches.create");
      }
      cache = { nombre: creado.name, huella, expiraEn: ahoraMs + ttlCacheSegundos * 1000 - MARGEN_EXPIRACION_MS };
      return cache.nombre;
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error : new Error(String(error)) },
        "No se pudo crear/renovar el cache de tools de Gemini -- se sigue enviando el catálogo completo sin cachear",
      );
      cache = null;
      return undefined;
    }
  }

  return {
    async generarRespuesta({ systemInstruction, contents, tools }) {
      const cachedContent = await obtenerCacheDeTools(tools);

      return ai.models.generateContent({
        model: modelo,
        contents,
        config: {
          systemInstruction,
          ...(cachedContent
            ? { cachedContent }
            : tools.length > 0
              ? { tools: [{ functionDeclarations: tools }] }
              : {}),
        },
      });
    },
  };
}
