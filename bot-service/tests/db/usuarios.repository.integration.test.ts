import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUsuariosRepository } from "../../src/db/usuarios.repository.js";
import { isDockerAvailable, startTestPostgres, type TestPostgres } from "./testPostgresContainer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../../src/db/migrations/0001_create_usuarios_autorizados.sql");

/**
 * Integración real con Postgres (Testing Strategy de la historia: "contenedor
 * efímero"). Se salta automáticamente si no hay un daemon Docker alcanzable
 * — en ese caso la cobertura de `findByChatId` y del esquema queda solo en
 * los tests mockeados de `usuarios.repository.test.ts`, y esta suite corre
 * completa en cualquier entorno con Docker activo (VPS, o una máquina de
 * desarrollo con el daemon corriendo).
 */
describe.skipIf(!isDockerAvailable())("usuariosRepository (integración con Postgres real)", () => {
  let testDb: TestPostgres;
  let client: Client;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    client = new Client({ connectionString: testDb.connectionString });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await testDb?.stop();
  });

  it("la migración crea la tabla con las columnas esperadas y es idempotente (AC #1)", async () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");

    await client.query(sql);
    await client.query(sql); // segunda corrida no debe fallar

    const { rows } = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'usuarios_autorizados' ORDER BY column_name",
    );

    expect(rows).toEqual([
      { column_name: "activo", data_type: "boolean" },
      { column_name: "chat_id", data_type: "bigint" },
      { column_name: "creado_en", data_type: "timestamp with time zone" },
    ]);
  });

  it("findByChatId consulta datos reales sembrados: activo, inactivo e inexistente (AC #2, #3)", async () => {
    await client.query(
      "INSERT INTO usuarios_autorizados (chat_id, activo) VALUES ($1, $2), ($3, $4) ON CONFLICT (chat_id) DO NOTHING",
      [111, true, 222, false],
    );

    const repo = createUsuariosRepository(client);

    expect(await repo.findByChatId(111)).toEqual({ chatId: 111, activo: true });
    expect(await repo.findByChatId(222)).toEqual({ chatId: 222, activo: false });
    expect(await repo.findByChatId(333)).toBeNull();
  });
});
