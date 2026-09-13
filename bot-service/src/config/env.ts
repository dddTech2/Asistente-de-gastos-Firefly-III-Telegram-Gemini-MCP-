import "dotenv/config";
import { decodificarClaveCifrado } from "../auth/pat-crypto.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

export const env = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  webhookPath: process.env.WEBHOOK_PATH || "/webhook/telegram",
  publicUrl: process.env.PUBLIC_URL || "",
  port: Number(process.env.PORT) || 3000,
  // Requerido (no opcional): la whitelist de la historia 1.1 es la primera
  // barrera de aislamiento entre usuarios — el proceso no debe arrancar sin
  // poder consultarla.
  databaseUrl: required("DATABASE_URL"),
  // Historia 1.4: clave simétrica de AES-256-GCM para el PAT en reposo.
  // Requerida (no opcional): AC #4 exige que el servicio no arranque sin ella.
  // decodificarClaveCifrado también valida el largo -- una clave mal formada
  // falla acá, no en el primer cifrado/descifrado real.
  patEncryptionKey: decodificarClaveCifrado(required("PAT_ENCRYPTION_KEY")),
  // Solo los usa `scripts/alta-usuario.ts` (historia 1.3) — deliberadamente
  // NO son `required()` acá: el proceso principal del bot (webhook) no debe
  // dejar de arrancar por faltar un secreto que ni siquiera usa.
  fireflyAdminBaseUrl: process.env.FIREFLY_ADMIN_BASE_URL || "",
  fireflyAdminToken: process.env.FIREFLY_ADMIN_TOKEN || "",
  // Historia 3.1: PAT propio del desarrollador (fase de validación pre-multi-
  // tenancy, distinto del PAT admin "owner" de arriba) para que el comando
  // /gasto cree transacciones reales. Requeridos: el proceso principal ya usa
  // esto para una funcionalidad real, no solo un script de un solo uso.
  fireflyPat: required("FIREFLY_PAT"),
  fireflyBaseUrl: required("FIREFLY_BASE_URL"),
  // Cuenta de activo (asset account) de origen ya existente en Firefly III --
  // Firefly exige una para crear un withdrawal. No especificado por ningún
  // documento fuente de la historia [Inference], ver Dev Agent Record de 3.1.
  fireflySourceAccount: required("FIREFLY_SOURCE_ACCOUNT"),
  // Historia 5.13: el proceso principal ahora sí construye el orquestador de
  // Gemini (geminiClient/mcpToolExecutor/historyStore) para mensajes de texto
  // libre -- estas cuatro variables ya estaban documentadas en `.env.example`
  // desde la historia 5.1, pero ningún proceso las leía hasta esta historia.
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
  mcpFireflyUrl: required("MCP_FIREFLY_URL"),
  redisUrl: required("REDIS_URL"),
};
