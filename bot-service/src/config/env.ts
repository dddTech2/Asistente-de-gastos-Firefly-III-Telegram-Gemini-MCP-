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
};
