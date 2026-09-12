import { Pool } from "pg";
import { env } from "../src/config/env.js";
import { createUsuariosRepository } from "../src/db/usuarios.repository.js";
import { createFireflyAdminClient } from "../src/provisioning/firefly-admin-client.js";
import { ejecutarAltaUsuario, entregarPatUsuario, type PatSink } from "../src/provisioning/alta-usuario.js";

/**
 * CLI de un solo uso para el administrador (AC #1-#6, historia 1.3). No forma
 * parte del "Owned File/Module Scope" original de la historia (solo listaba
 * `src/provisioning/*`), pero sin un punto de entrada ejecutable el AC #1
 * ("cuando el administrador ejecuta el flujo de alta") no tiene forma real de
 * correr -- mismo patrón que `scripts/migrate.ts` (historia 1.1). Documentado
 * como desviación en el Dev Agent Record de 1.3.
 *
 * Uso:
 *   npm run alta-usuario -- crear --nombre "Juan" --email juan@ej.com --chat-id 123456789 --admin dazad
 *   npm run alta-usuario -- completar-pat --chat-id 123456789 --pat <PAT> --admin dazad
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

function requerido(args: Record<string, string>, nombre: string): string {
  const valor = args[nombre];
  if (!valor) {
    throw new Error(`Falta el argumento --${nombre}`);
  }
  return valor;
}

/**
 * Placeholder explícito hasta que exista la historia 1.4 (cifrado +
 * persistencia). No escribe el PAT a disco, log ni tabla en ningún momento
 * (AC #5) -- lo recibe en memoria y lo descarta, avisando claramente que
 * todavía no hay dónde guardarlo de forma permanente.
 */
const sinkPendienteDeHistoria14: PatSink = async (chatId) => {
  console.warn(
    `⚠️  Historia 1.4 (cifrado + persistencia del PAT) todavía no está implementada. ` +
      `El PAT de chat_id ${chatId} se recibió en memoria y se descarta acá -- no queda ` +
      `guardado en ningún lado. Repetir este paso una vez que 1.4 esté lista.`,
  );
};

async function main(): Promise<void> {
  const [comando, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (comando === "crear") {
    if (!env.fireflyAdminBaseUrl || !env.fireflyAdminToken) {
      throw new Error(
        "Faltan FIREFLY_ADMIN_BASE_URL / FIREFLY_ADMIN_TOKEN en .env -- requeridos solo para este script.",
      );
    }

    const nombre = requerido(args, "nombre");
    const email = requerido(args, "email");
    const chatId = Number(requerido(args, "chat-id"));
    const administrador = requerido(args, "admin");

    if (!Number.isFinite(chatId)) {
      throw new Error("--chat-id debe ser numérico");
    }

    const pool = new Pool({ connectionString: env.databaseUrl });
    try {
      const usuariosRepository = createUsuariosRepository(pool);
      const fireflyAdminClient = createFireflyAdminClient({
        baseUrl: env.fireflyAdminBaseUrl,
        ownerToken: env.fireflyAdminToken,
      });

      const resultado = await ejecutarAltaUsuario(
        { nombre, email, chatId },
        { fireflyAdminClient, usuariosRepository, fireflyBaseUrl: env.fireflyAdminBaseUrl },
        administrador,
      );

      console.log(`✅ Cuenta Firefly creada: id=${resultado.fireflyUserId}, email=${email}`);
      console.log(`✅ chat_id ${chatId} habilitado en la whitelist.`);
      console.log(`\nInstrucciones para el usuario:\n${resultado.instrucciones}`);
    } finally {
      await pool.end();
    }
    return;
  }

  if (comando === "completar-pat") {
    const chatId = Number(requerido(args, "chat-id"));
    const pat = requerido(args, "pat");
    const administrador = requerido(args, "admin");

    if (!Number.isFinite(chatId)) {
      throw new Error("--chat-id debe ser numérico");
    }

    await entregarPatUsuario(chatId, pat, administrador, sinkPendienteDeHistoria14);
    return;
  }

  throw new Error(`Comando desconocido: "${comando ?? ""}". Usar "crear" o "completar-pat".`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
