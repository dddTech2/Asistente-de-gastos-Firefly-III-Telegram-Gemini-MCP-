import "dotenv/config";

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
  // Solo los usa `scripts/alta-usuario.ts` (historia 1.3) — deliberadamente
  // NO son `required()` acá: el proceso principal del bot (webhook) no debe
  // dejar de arrancar por faltar un secreto que ni siquiera usa.
  fireflyAdminBaseUrl: process.env.FIREFLY_ADMIN_BASE_URL || "",
  fireflyAdminToken: process.env.FIREFLY_ADMIN_TOKEN || "",
};
