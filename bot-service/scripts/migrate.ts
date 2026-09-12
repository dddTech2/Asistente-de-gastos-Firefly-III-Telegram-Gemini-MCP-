import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { env } from "../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../src/db/migrations");

/**
 * Sin tabla de control de migraciones aplicadas todavía — cada archivo `.sql`
 * debe ser idempotente por sí mismo (`CREATE TABLE IF NOT EXISTS`, etc.).
 * Con un solo archivo hoy (historia 1.1) alcanza; si la carpeta crece lo
 * suficiente como para que reaplicar todo en cada deploy sea un problema real,
 * ese es el momento de sumar una tabla de control — no antes.
 */
async function main(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No hay migraciones para aplicar.");
    return;
  }

  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();

  try {
    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`Aplicando ${file}...`);
      await client.query(sql);
    }
    console.log(`✅ ${files.length} migración(es) aplicada(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
