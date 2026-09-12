import type { Bot } from "grammy";
import { sendTelegramMessage } from "../telegram/sendMessage.js";

export function formatEchoReply(text: string): string {
  return `Recibido: "${text}"`;
}

/**
 * `bot.on("message:text", ...)` solo dispara para updates con mensaje de texto:
 * stickers, fotos u otro tipo de update simplemente no matchean el filtro y
 * nunca llegan acá — así se cumple el AC #3 (no romper con updates no soportados)
 * sin necesidad de un try/catch propio (el catch de telegramWebhook.ts sigue
 * cubriendo cualquier error inesperado dentro del handler).
 */
export function registerEchoHandler(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    const reply = formatEchoReply(ctx.message.text);
    await sendTelegramMessage(bot, ctx.chat.id, reply);
  });
}
