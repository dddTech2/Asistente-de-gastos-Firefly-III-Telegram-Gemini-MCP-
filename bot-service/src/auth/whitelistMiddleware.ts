import type { Bot, Context, MiddlewareFn, NextFunction } from "grammy";
import type { UsuariosRepository } from "../db/usuarios.repository.js";
import { logger } from "../lib/logger.js";
import { sendTelegramMessage } from "../telegram/sendMessage.js";

const MENSAJE_NO_AUTORIZADO = "No autorizado. Este bot es de uso privado.";

/**
 * Registrado con `bot.use(...)` ANTES que cualquier otro handler (echo,
 * futura lógica de negocio) — en grammY, si un middleware no llama a `next()`
 * el resto de la cadena simplemente no se ejecuta para ese update (AC #2,
 * #4). Fail closed: tanto un `chat_id` no identificable como un fallo de
 * Postgres niegan el acceso en vez de dejarlo pasar, porque el aislamiento
 * entre usuarios es el NFR crítico del proyecto [Source: bmad-output/stories/1.1.whitelist-chat-id.story.md#dev-notes].
 *
 * Usa `sendTelegramMessage(bot, ...)` en vez de `ctx.reply(...)`: grammY crea
 * una instancia de `Api` nueva por update dentro de `handleUpdate` (no
 * reutiliza `bot.api`), así que `ctx.reply` no pasa por el mismo cliente que
 * el resto del código ya usa e inyecta en los tests (mismo motivo por el que
 * `echoHandler.ts` evita `ctx.reply` — historia 2.2).
 */
export function createWhitelistMiddleware(bot: Bot, repository: UsuariosRepository): MiddlewareFn<Context> {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const chatId = ctx.chat?.id;

    if (chatId === undefined) {
      logger.info({}, "Update sin chat_id identificable, descartado antes de la whitelist");
      return;
    }

    let usuario;
    try {
      usuario = await repository.findByChatId(chatId);
    } catch (error) {
      logger.error(
        { chat_id: chatId, err: error instanceof Error ? error : new Error(String(error)) },
        "Fallo al consultar la whitelist, se niega el acceso (fail closed)",
      );
      return;
    }

    const autorizado = usuario !== null && usuario.activo;

    // AC #5: solo chat_id + resultado, nunca el texto del mensaje ni datos de
    // otros usuarios.
    logger.info({ chat_id: chatId, autorizado }, "Intento de acceso evaluado por la whitelist");

    if (!autorizado) {
      await sendTelegramMessage(bot, chatId, MENSAJE_NO_AUTORIZADO);
      return;
    }

    await next();
  };
}
