import { env } from "../src/config/env.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface WebhookInfo {
  url: string;
  last_error_message?: string;
}

async function main(): Promise<void> {
  if (!env.publicUrl) {
    throw new Error("PUBLIC_URL no está configurado en .env — necesario para registrar el webhook.");
  }
  if (!env.publicUrl.startsWith("https://")) {
    throw new Error(
      `PUBLIC_URL debe empezar con https:// (Telegram rechaza webhooks sin HTTPS). Valor actual: ${env.publicUrl}`,
    );
  }

  const webhookUrl = `${env.publicUrl.replace(/\/$/, "")}${env.webhookPath}`;
  const apiBase = `https://api.telegram.org/bot${env.telegramBotToken}`;

  console.log(`Registrando webhook: ${webhookUrl}`);

  const setResponse = await fetch(`${apiBase}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.telegramWebhookSecret,
    }),
  });
  const setResult = (await setResponse.json()) as TelegramApiResponse<boolean>;
  console.log("Respuesta de setWebhook:", JSON.stringify(setResult, null, 2));

  if (!setResult.ok) {
    throw new Error(`setWebhook falló: ${setResult.description ?? "sin descripción"}`);
  }

  const infoResponse = await fetch(`${apiBase}/getWebhookInfo`);
  const infoResult = (await infoResponse.json()) as TelegramApiResponse<WebhookInfo>;
  console.log("Respuesta de getWebhookInfo:", JSON.stringify(infoResult, null, 2));

  if (infoResult.result?.last_error_message) {
    console.warn(
      `⚠️ getWebhookInfo reporta un error: "${infoResult.result.last_error_message}" — AC #5 no se cumple todavía.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("✅ Webhook registrado sin errores (AC #5 cumplido).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
