import { Pool } from "pg";
import { env } from "../src/config/env.js";
import { createUsoTokensGeminiRepository, type ResumenUsoTokens } from "../src/db/usoTokensGemini.repository.js";

/**
 * CLI de consulta para el administrador (historia 8.7, AC #4). Mismo patrón
 * que `scripts/alta-usuario.ts` (historia 1.3): un solo archivo, `Pool` propio
 * cerrado en `finally`, sin test dedicado al wrapper (la lógica testeable
 * vive en el repositorio).
 *
 * Uso:
 *   npm run reporte-tokens -- --mes 2026-09
 *   npm run reporte-tokens -- --chat-id 123456789 --mes 2026-09
 *   npm run reporte-tokens -- --chat-id 123456789 --desde 2026-09-01 --hasta 2026-10-01
 */

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      result[key] = value;
      i += 1;
    }
  }
  return result;
}

function rangoDelMes(mes: string): { desde: Date; hasta: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!match) {
    throw new Error(`--mes debe tener el formato YYYY-MM (recibido: "${mes}")`);
  }
  const anio = Number(match[1]);
  const mesNumero = Number(match[2]);
  return {
    desde: new Date(Date.UTC(anio, mesNumero - 1, 1)),
    hasta: new Date(Date.UTC(anio, mesNumero, 1)),
  };
}

function imprimirResumen(titulo: string, resumen: ResumenUsoTokens): void {
  console.log(`\n${titulo}`);
  console.log(`  Llamadas a Gemini:                ${resumen.cantidadLlamadas}`);
  console.log(`  Tokens de entrada (prompt):        ${resumen.promptTokens}`);
  console.log(`  Tokens de salida (candidates):     ${resumen.candidatesTokens}`);
  console.log(`  Tokens de "thinking":              ${resumen.thoughtsTokens}`);
  console.log(`  Tokens de resultados de tools:     ${resumen.toolTokens}`);
  console.log(`  Tokens servidos desde el cache:    ${resumen.cachedTokens}`);
  console.log(`  Total:                             ${resumen.totalTokens}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: env.databaseUrl });

  try {
    const repositorio = createUsoTokensGeminiRepository(pool);

    if (args["chat-id"]) {
      const chatId = Number(args["chat-id"]);
      if (!Number.isFinite(chatId)) {
        throw new Error("--chat-id debe ser numérico");
      }
      const { desde, hasta } = args.mes
        ? rangoDelMes(args.mes)
        : { desde: new Date(args.desde ?? "1970-01-01"), hasta: new Date(args.hasta ?? "2999-01-01") };

      const resumen = await repositorio.resumenPorChat(chatId, desde, hasta);
      imprimirResumen(
        `Uso de tokens -- chat_id ${chatId} (${desde.toISOString().slice(0, 10)} a ${hasta.toISOString().slice(0, 10)})`,
        resumen,
      );
      return;
    }

    if (args.mes) {
      const { desde, hasta } = rangoDelMes(args.mes);
      const resumen = await repositorio.resumenPorRango(desde, hasta);
      imprimirResumen(`Uso de tokens -- todos los chats -- mes ${args.mes}`, resumen);
      return;
    }

    throw new Error(
      "Uso: --mes YYYY-MM [--chat-id N] | --chat-id N [--mes YYYY-MM | --desde YYYY-MM-DD --hasta YYYY-MM-DD]",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
