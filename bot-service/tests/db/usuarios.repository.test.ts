import { describe, expect, it, vi } from "vitest";
import { createUsuariosRepository, type QueryableDb } from "../../src/db/usuarios.repository.js";

// Clave dummy de 32 bytes (64 hex) -- solo para tests, nunca un secreto real.
const CLAVE_TEST = Buffer.from("0".repeat(64), "hex");

function buildDb(rows: unknown[]): QueryableDb {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as QueryableDb;
}

describe("createUsuariosRepository.findByChatId", () => {
  it("retorna null si el chat_id no existe (AC #2)", async () => {
    const db = buildDb([]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    expect(await repo.findByChatId(123)).toBeNull();
  });

  it("retorna el usuario con activo=true (AC #3)", async () => {
    const db = buildDb([{ chat_id: "123", activo: true }]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    expect(await repo.findByChatId(123)).toEqual({ chatId: 123, activo: true });
  });

  it("retorna el usuario con activo=false (AC #2)", async () => {
    const db = buildDb([{ chat_id: "456", activo: false }]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    expect(await repo.findByChatId(456)).toEqual({ chatId: 456, activo: false });
  });

  it("consulta con el chat_id como parámetro parametrizado, no interpolado en el SQL", async () => {
    const db = buildDb([]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    await repo.findByChatId(789);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("WHERE chat_id = $1"), [789]);
  });
});

describe("createUsuariosRepository.crear", () => {
  it("inserta el chat_id con los valores dados, parametrizados (historia 1.3)", async () => {
    const db = buildDb([]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    await repo.crear({ chatId: 999, activo: true });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO usuarios_autorizados"), [
      999,
      true,
    ]);
  });
});
