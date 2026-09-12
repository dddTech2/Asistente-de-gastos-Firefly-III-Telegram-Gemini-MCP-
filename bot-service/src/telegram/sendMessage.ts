import type { Bot } from "grammy";

/**
 * Envoltorio delgado sobre `bot.api.sendMessage` — existe como módulo propio
 * para poder mockearlo en tests unitarios sin pegarle a la API real de Telegram.
 */
export async function sendTelegramMessage(bot: Bot, chatId: number, text: string): Promise<void> {
  await bot.api.sendMessage(chatId, text);
}
