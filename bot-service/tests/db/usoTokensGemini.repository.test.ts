import { describe, expect, it, vi } from "vitest";
import { createUsoTokensGeminiRepository, type QueryableDb } from "../../src/db/usoTokensGemini.repository.js";

function buildDb(rows: unknown[]): QueryableDb {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as QueryableDb;
}

const USO_EJEMPLO = {
  promptTokens: 100,
  candidatesTokens: 30,
  thoughtsTokens: 10,
  toolTokens: 5,
  cachedTokens: 60,
  totalTokens: 145,
};

describe("createUsoTokensGeminiRepository.registrar", () => {
  it("inserta los 7 parámetros correctos, en orden (AC #1)", async () => {
    const db = buildDb([]);
    const repo = createUsoTokensGeminiRepository(db);

    await repo.registrar(999, USO_EJEMPLO);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO log_uso_tokens_gemini"), [
      999,
      100,
      30,
      10,
      5,
      60,
      145,
    ]);
  });
});

describe("createUsoTokensGeminiRepository.resumenPorChat", () => {
  it("filtra por chat_id y rango de fechas (AC #4)", async () => {
    const db = buildDb([]);
    const repo = createUsoTokensGeminiRepository(db);
    const desde = new Date("2026-09-01T00:00:00.000Z");
    const hasta = new Date("2026-10-01T00:00:00.000Z");

    await repo.resumenPorChat(555, desde, hasta);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("WHERE chat_id = $1"), [555, desde, hasta]);
  });

  it("convierte los COUNT/SUM (strings de Postgres) a number", async () => {
    const db = buildDb([
      {
        cantidad_llamadas: "3",
        prompt_tokens: "300",
        candidates_tokens: "90",
        thoughts_tokens: "20",
        tool_tokens: "15",
        cached_tokens: "180",
        total_tokens: "425",
      },
    ]);
    const repo = createUsoTokensGeminiRepository(db);

    const resumen = await repo.resumenPorChat(555, new Date(), new Date());

    expect(resumen).toEqual({
      cantidadLlamadas: 3,
      promptTokens: 300,
      candidatesTokens: 90,
      thoughtsTokens: 20,
      toolTokens: 15,
      cachedTokens: 180,
      totalTokens: 425,
    });
  });

  it("devuelve todo en 0 si no hay filas (ninguna llamada en el período)", async () => {
    const db = buildDb([]);
    const repo = createUsoTokensGeminiRepository(db);

    const resumen = await repo.resumenPorChat(555, new Date(), new Date());

    expect(resumen).toEqual({
      cantidadLlamadas: 0,
      promptTokens: 0,
      candidatesTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    });
  });
});

describe("createUsoTokensGeminiRepository.resumenPorRango", () => {
  it("filtra solo por rango de fechas, sin chat_id (AC #4, agregado mensual)", async () => {
    const db = buildDb([]);
    const repo = createUsoTokensGeminiRepository(db);
    const desde = new Date("2026-09-01T00:00:00.000Z");
    const hasta = new Date("2026-10-01T00:00:00.000Z");

    await repo.resumenPorRango(desde, hasta);

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).not.toContain("chat_id =");
    expect(params).toEqual([desde, hasta]);
  });
});
