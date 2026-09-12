import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUsuariosRepository, type QueryableDb } from "../../src/db/usuarios.repository.js";
import { isDockerAvailable, startTestPostgres, type TestPostgres } from "./testPostgresContainer.js";

// Clave dummy de 32 bytes (64 hex) -- solo para tests, nunca un secreto real.
const CLAVE_TEST = Buffer.from("0".repeat(64), "hex");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../../src/db/migrations");

function buildDb(rows: unknown[]): QueryableDb {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as unknown as QueryableDb;
}

describe("usuariosRepository.guardarPatCifrado / obtenerPatDescifrado (unitario, db mockeada)", () => {
  it("cifra el PAT antes de guardarlo -- el valor enviado a la query nunca es el texto plano (AC #2)", async () => {
    const db: QueryableDb = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as QueryableDb;
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    await repo.guardarPatCifrado(123, "pat-secreto-de-prueba");

    const llamada = (db.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(llamada[0]).toContain("UPDATE usuarios_autorizados SET pat_cifrado");
    const [valorGuardado, chatId] = llamada[1];
    expect(valorGuardado).not.toContain("pat-secreto-de-prueba");
    expect(chatId).toBe(123);
  });

  it("falla si el chat_id no existe (0 filas afectadas)", async () => {
    const db: QueryableDb = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as unknown as QueryableDb;
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    await expect(repo.guardarPatCifrado(999, "pat-x")).rejects.toThrow(/No existe el chat_id/);
  });

  it("descifra el valor guardado y devuelve el PAT original (round-trip vía repositorio)", async () => {
    let filaGuardada: { pat_cifrado: string } | undefined;
    const db: QueryableDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.startsWith("UPDATE")) {
          filaGuardada = { pat_cifrado: params[0] as string };
          return { rows: [], rowCount: 1 };
        }
        return { rows: filaGuardada ? [filaGuardada] : [] };
      }),
    } as unknown as QueryableDb;
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    await repo.guardarPatCifrado(555, "pat-original-de-prueba");

    expect(await repo.obtenerPatDescifrado(555)).toBe("pat-original-de-prueba");
  });

  it("devuelve null si el chat_id no tiene fila", async () => {
    const db = buildDb([]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    expect(await repo.obtenerPatDescifrado(404)).toBeNull();
  });

  it("devuelve null si el chat_id existe pero todavía no tiene PAT entregado (edge case)", async () => {
    const db = buildDb([{ pat_cifrado: null }]);
    const repo = createUsuariosRepository(db, CLAVE_TEST);

    expect(await repo.obtenerPatDescifrado(555)).toBeNull();
  });
});

/**
 * Integración real con Postgres (mismo patrón que
 * usuarios.repository.integration.test.ts de 1.1) -- se salta si no hay
 * Docker disponible. Aplica ambas migraciones (0001 + 0002) para probar el
 * flujo completo de la historia 1.4 sobre el esquema real.
 */
describe.skipIf(!isDockerAvailable())("usuariosRepository PAT (integración con Postgres real)", () => {
  let testDb: TestPostgres;
  let client: Client;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    client = new Client({ connectionString: testDb.connectionString });
    await client.connect();
    for (const archivo of ["0001_create_usuarios_autorizados.sql", "0002_add_pat_cifrado_column.sql"]) {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, archivo), "utf-8"));
    }
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await testDb?.stop();
  });

  it("una fila leída directamente de Postgres nunca contiene el PAT en texto plano (AC #2)", async () => {
    await client.query("INSERT INTO usuarios_autorizados (chat_id, activo) VALUES ($1, $2)", [777, true]);
    const repo = createUsuariosRepository(client, CLAVE_TEST);
    const patOriginal = "pat-real-de-integracion-777";

    await repo.guardarPatCifrado(777, patOriginal);

    const { rows } = await client.query("SELECT pat_cifrado FROM usuarios_autorizados WHERE chat_id = $1", [777]);
    expect(rows[0].pat_cifrado).not.toBe(patOriginal);
    expect(rows[0].pat_cifrado).not.toContain(patOriginal);
  });

  it("obtenerPatDescifrado devuelve el PAT exacto guardado por guardarPatCifrado (AC #3)", async () => {
    await client.query("INSERT INTO usuarios_autorizados (chat_id, activo) VALUES ($1, $2)", [888, true]);
    const repo = createUsuariosRepository(client, CLAVE_TEST);
    const patOriginal = "pat-real-de-integracion-888";

    await repo.guardarPatCifrado(888, patOriginal);

    expect(await repo.obtenerPatDescifrado(888)).toBe(patOriginal);
  });

  it("obtenerPatDescifrado devuelve null para un chat_id sin PAT entregado todavía (edge case)", async () => {
    await client.query("INSERT INTO usuarios_autorizados (chat_id, activo) VALUES ($1, $2)", [999, true]);
    const repo = createUsuariosRepository(client, CLAVE_TEST);

    expect(await repo.obtenerPatDescifrado(999)).toBeNull();
  });
});
