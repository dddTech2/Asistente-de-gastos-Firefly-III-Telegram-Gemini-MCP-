import type { Pool } from "pg";
import type { UsoTokensGemini } from "../gemini/usoTokens.js";

/**
 * Subconjunto de `Pool` que este repositorio necesita -- mismo criterio que
 * `usuarios.repository.ts` (permite pasar un `Client` suelto en tests de
 * integración sin pelear con el tipado completo de `Pool`).
 */
export interface QueryableDb {
  query: Pool["query"];
}

export interface ResumenUsoTokens {
  cantidadLlamadas: number;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  toolTokens: number;
  totalTokens: number;
}

interface ResumenRow {
  cantidad_llamadas: string;
  prompt_tokens: string | null;
  candidates_tokens: string | null;
  thoughts_tokens: string | null;
  tool_tokens: string | null;
  total_tokens: string | null;
}

const SELECT_RESUMEN = `
  SELECT
    COUNT(*) AS cantidad_llamadas,
    COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
    COALESCE(SUM(candidates_tokens), 0) AS candidates_tokens,
    COALESCE(SUM(thoughts_tokens), 0) AS thoughts_tokens,
    COALESCE(SUM(tool_tokens), 0) AS tool_tokens,
    COALESCE(SUM(total_tokens), 0) AS total_tokens
  FROM log_uso_tokens_gemini
`;

function filaAResumen(fila: ResumenRow | undefined): ResumenUsoTokens {
  return {
    cantidadLlamadas: Number(fila?.cantidad_llamadas ?? 0),
    promptTokens: Number(fila?.prompt_tokens ?? 0),
    candidatesTokens: Number(fila?.candidates_tokens ?? 0),
    thoughtsTokens: Number(fila?.thoughts_tokens ?? 0),
    toolTokens: Number(fila?.tool_tokens ?? 0),
    totalTokens: Number(fila?.total_tokens ?? 0),
  };
}

/**
 * Historia 8.7: persiste el consumo de tokens de cada llamada real a Gemini
 * (`chat_id` + los 5 contadores de `usoTokens.ts`) y expone los dos resúmenes
 * agregados que pide el AC #4 -- por chat_id + rango, y por rango solo (para
 * el agregado mensual de todas las conversaciones). Sin purga: registro de
 * auditoría de largo plazo, igual criterio que `log_auditoria_ia` (8.2).
 */
export function createUsoTokensGeminiRepository(db: QueryableDb) {
  return {
    async registrar(chatId: number, uso: UsoTokensGemini): Promise<void> {
      await db.query(
        `INSERT INTO log_uso_tokens_gemini
           (chat_id, prompt_tokens, candidates_tokens, thoughts_tokens, tool_tokens, total_tokens)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [chatId, uso.promptTokens, uso.candidatesTokens, uso.thoughtsTokens, uso.toolTokens, uso.totalTokens],
      );
    },

    async resumenPorChat(chatId: number, desde: Date, hasta: Date): Promise<ResumenUsoTokens> {
      const resultado = await db.query<ResumenRow>(
        `${SELECT_RESUMEN} WHERE chat_id = $1 AND creado_en >= $2 AND creado_en < $3`,
        [chatId, desde, hasta],
      );
      return filaAResumen(resultado.rows[0]);
    },

    async resumenPorRango(desde: Date, hasta: Date): Promise<ResumenUsoTokens> {
      const resultado = await db.query<ResumenRow>(`${SELECT_RESUMEN} WHERE creado_en >= $1 AND creado_en < $2`, [
        desde,
        hasta,
      ]);
      return filaAResumen(resultado.rows[0]);
    },
  };
}

export type UsoTokensGeminiRepository = ReturnType<typeof createUsoTokensGeminiRepository>;
