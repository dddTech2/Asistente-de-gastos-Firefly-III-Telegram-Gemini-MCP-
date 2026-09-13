import type { Bot } from "grammy";
import { CredencialesNoDisponiblesError } from "../auth/credential-resolver.js";
import { sendTelegramMessage } from "../telegram/sendMessage.js";
import { logger } from "../lib/logger.js";
import type { MessageOrchestrator } from "./messageOrchestrator.js";

const MENSAJE_SIN_CREDENCIALES =
  "Todavía no tenés una cuenta vinculada. Pedile a un administrador que te dé de alta antes de poder usar el asistente.";
const MENSAJE_ERROR_GENERICO = "No pude procesar tu mensaje. Probá de nuevo en un momento.";

/**
 * Reemplaza a `echoHandler.ts` (historia 2.2) como handler de
 * `message:text` en el flujo real (historia 5.13, AC #1). Se registra
 * DESPUÉS de `/gasto` y `/resumen` (mismo orden de precedencia ya
 * establecido) para que solo el texto libre que no matchea ningún comando
 * llegue acá.
 *
 * Distingue `CredencialesNoDisponiblesError` (AC #3 -- el usuario pasó la
 * whitelist pero no tiene PAT propio cargado) de cualquier otra excepción
 * (AC #4 -- falla técnica de red/Gemini/MCP): `messageOrchestrator.ts` no
 * captura la primera internamente, así que este es el único lugar que
 * puede diferenciarlas antes de responderle al usuario.
 */
export function registerGeminiMessageHandler(bot: Bot, messageOrchestrator: MessageOrchestrator): void {
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;

    try {
      const respuesta = await messageOrchestrator.procesarMensaje(chatId, ctx.message.text);
      await sendTelegramMessage(bot, chatId, respuesta);
    } catch (error) {
      if (error instanceof CredencialesNoDisponiblesError) {
        logger.warn({ chat_id: chatId }, "Mensaje de texto libre sin credenciales de Firefly III disponibles");
        await sendTelegramMessage(bot, chatId, MENSAJE_SIN_CREDENCIALES);
        return;
      }

      logger.error(
        { chat_id: chatId, err: error instanceof Error ? error : new Error(String(error)) },
        "Fallo al procesar un mensaje de texto libre con el orquestador de Gemini",
      );
      await sendTelegramMessage(bot, chatId, MENSAJE_ERROR_GENERICO);
    }
  });
}
