import type { Request, RequestHandler, Response } from "express";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { createWhitelistMiddleware } from "../auth/whitelistMiddleware.js";
import type { UsuariosRepository } from "../db/usuarios.repository.js";
import { registerEchoHandler } from "../handlers/echoHandler.js";
import { InMemoryProcessingQueue } from "../queue/inMemoryProcessingQueue.js";
import { logger } from "../lib/logger.js";

/**
 * `update_id`/`chat_id` viajan en cada log para poder correlacionar reintentos
 * de Telegram con lo que el bot realmente procesó (historia 8.1, AC #2 — y
 * preparación para la deduplicación de la historia 6.1). Cubre los tipos de
 * update que ya puede recibir este bot; uno no reconocido simplemente no
 * aporta chat_id (no es un error).
 */
function extractLogContext(update: unknown): { update_id?: number; chat_id?: number } {
  if (typeof update !== "object" || update === null) {
    return {};
  }
  const record = update as Record<string, unknown>;
  const update_id = typeof record.update_id === "number" ? record.update_id : undefined;

  const messageLike =
    (record.message as { chat?: { id?: unknown } } | undefined) ??
    (record.edited_message as { chat?: { id?: unknown } } | undefined) ??
    (record.channel_post as { chat?: { id?: unknown } } | undefined) ??
    (record.edited_channel_post as { chat?: { id?: unknown } } | undefined) ??
    (record.callback_query as { message?: { chat?: { id?: unknown } } } | undefined)?.message;

  const chat_id = typeof messageLike?.chat?.id === "number" ? messageLike.chat.id : undefined;

  return { update_id, chat_id };
}

/**
 * Responde 200 apenas se acepta el update (ya pasó `verifySecretToken`),
 * ANTES de procesarlo (historia 2.3, AC #1/#2) — así Telegram nunca ve un
 * timeout aunque el procesamiento (echo, futura lógica de negocio) tarde o
 * lleguen varios updates a la vez. El procesamiento real se desacopla del
 * ciclo request/response vía `InMemoryProcessingQueue`; un error ahí ya no
 * puede tocar la respuesta HTTP (AC #4), solo se loggea (historia 8.1).
 *
 * El middleware de whitelist (historia 1.1) se registra ANTES que cualquier
 * handler de negocio (echo, futuro Firefly/Gemini/MCP) — en grammY, si no
 * llama a `next()`, el resto de la cadena no corre para ese update (AC #4).
 */
export function createTelegramWebhookHandler(bot: Bot, usuariosRepository: UsuariosRepository): RequestHandler {
  bot.use(createWhitelistMiddleware(bot, usuariosRepository));
  registerEchoHandler(bot);

  const queue = new InMemoryProcessingQueue<Update>(
    async (update) => {
      const context = extractLogContext(update);
      logger.info(context, "Procesando update desencolado");
      await bot.handleUpdate(update);
      logger.debug(context, "Update procesado");
    },
    (error, update) => {
      const context = extractLogContext(update);
      logger.error(
        { ...context, err: error instanceof Error ? error : new Error(String(error)) },
        "Error procesando update de Telegram de forma asincrona",
      );
    },
  );

  return (req: Request, res: Response) => {
    const context = extractLogContext(req.body);
    logger.info(context, "Webhook de Telegram recibido");

    res.sendStatus(200);

    logger.debug(context, "Update encolado para procesamiento asincrono");
    queue.enqueue(req.body as Update);
  };
}
