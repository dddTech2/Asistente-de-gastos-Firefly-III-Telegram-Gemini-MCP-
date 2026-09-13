import { randomUUID } from "node:crypto";
import { InlineKeyboard, type Bot } from "grammy";
import { logger } from "../lib/logger.js";

const CALLBACK_CONFIRMAR = "irrev:si";
const CALLBACK_CANCELAR = "irrev:no";

interface ConfirmacionPendiente {
  chatId: number;
  ejecutar: () => Promise<void>;
}

const confirmacionesPendientes = new Map<string, ConfirmacionPendiente>();

/**
 * Pide confirmación en el chat antes de ejecutar una acción irreversible
 * (AC #3, #4 de la historia 4.3). `resumenAccion` es responsabilidad de
 * quien llama: debe ser texto legible por humano describiendo qué se va a
 * borrar/reconciliar y de qué cuenta/transacción -- nunca el JSON crudo de
 * la tool call ni el PAT del usuario (AC #5). Esta función no recibe ni ve
 * ninguno de los dos, así que no puede filtrarlos por error.
 *
 * No ejecuta `ejecutar` acá, solo la registra: la ejecución real ocurre en
 * `registerConfirmacionCallbackHandler`, disparada por la respuesta del
 * usuario. Si el bot se reinicia entre el envío y la respuesta, la
 * confirmación pendiente se pierde de forma segura (el peor caso es que el
 * botón ya no responda y haya que pedirla de nuevo) -- nunca se ejecuta sin
 * confirmación real.
 */
export async function solicitarConfirmacion(
  bot: Bot,
  chatId: number,
  resumenAccion: string,
  ejecutar: () => Promise<void>,
): Promise<void> {
  const id = randomUUID();
  confirmacionesPendientes.set(id, { chatId, ejecutar });

  const teclado = new InlineKeyboard()
    .text("✅ Sí, confirmar", `${CALLBACK_CONFIRMAR}:${id}`)
    .text("❌ Cancelar", `${CALLBACK_CANCELAR}:${id}`);

  await bot.api.sendMessage(chatId, `⚠️ Esta acción no se puede deshacer:\n\n${resumenAccion}\n\n¿Confirmás?`, {
    reply_markup: teclado,
  });
}

/**
 * Registra los handlers de los botones de confirmación/cancelación. Debe
 * llamarse una sola vez al armar el bot (mismo patrón que
 * `registerGastoHandler`).
 *
 * Usa `bot.api.*` (nunca `ctx.api.*`/`ctx.answerCallbackQuery`/
 * `ctx.editMessageText`) a propósito: grammy crea una instancia de `Api`
 * distinta por contexto, así que mockear `bot.api` en tests (mismo patrón que
 * `sendMessage.ts`) no interceptaría llamadas hechas vía `ctx.api`.
 */
export function registerConfirmacionCallbackHandler(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${escaparRegex(CALLBACK_CONFIRMAR)}:(.+)$`), (ctx) =>
    manejarRespuesta(bot, ctx.callbackQuery.id, ctx.callbackQuery.message?.chat.id, ctx.callbackQuery.message?.message_id, ctx.match[1]!, true),
  );

  bot.callbackQuery(new RegExp(`^${escaparRegex(CALLBACK_CANCELAR)}:(.+)$`), (ctx) =>
    manejarRespuesta(bot, ctx.callbackQuery.id, ctx.callbackQuery.message?.chat.id, ctx.callbackQuery.message?.message_id, ctx.match[1]!, false),
  );
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function manejarRespuesta(
  bot: Bot,
  callbackQueryId: string,
  chatId: number | undefined,
  messageId: number | undefined,
  id: string,
  confirmar: boolean,
): Promise<void> {
  const pendiente = confirmacionesPendientes.get(id);
  confirmacionesPendientes.delete(id);

  if (!pendiente) {
    await bot.api.answerCallbackQuery(callbackQueryId, { text: "Esta confirmación ya no es válida." });
    return;
  }

  if (chatId === undefined || messageId === undefined) {
    // No debería pasar en la práctica -- el mensaje de confirmación siempre
    // se manda a un chat real, nunca en modo inline. Fail-safe: si no
    // podemos ubicar el mensaje original, no ejecutamos.
    await bot.api.answerCallbackQuery(callbackQueryId, { text: "No se pudo procesar la respuesta." });
    return;
  }

  if (!confirmar) {
    await bot.api.answerCallbackQuery(callbackQueryId, { text: "Cancelado." });
    await bot.api.editMessageText(chatId, messageId, "❌ Acción cancelada. No se hizo ningún cambio.");
    return;
  }

  await bot.api.answerCallbackQuery(callbackQueryId, { text: "Confirmado, ejecutando..." });

  try {
    await pendiente.ejecutar();
    await bot.api.editMessageText(chatId, messageId, "✅ Acción confirmada y ejecutada.");
  } catch (error) {
    logger.error(
      { chat_id: pendiente.chatId, err: error instanceof Error ? error : new Error(String(error)) },
      "Fallo al ejecutar una acción irreversible tras confirmación del usuario",
    );
    await bot.api.editMessageText(chatId, messageId, "⚠️ La acción fue confirmada pero falló al ejecutarse. Intentá de nuevo.");
  }
}

/** Solo para tests: cantidad de confirmaciones pendientes en memoria. */
export function _confirmacionesPendientesParaTests(): number {
  return confirmacionesPendientes.size;
}

/** Solo para tests: limpia el estado en memoria entre tests (módulo singleton). */
export function _resetConfirmacionesPendientesParaTests(): void {
  confirmacionesPendientes.clear();
}
