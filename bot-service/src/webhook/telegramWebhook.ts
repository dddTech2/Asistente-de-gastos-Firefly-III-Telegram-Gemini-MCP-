import type { Request, RequestHandler, Response } from "express";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerEchoHandler } from "../handlers/echoHandler.js";
import { InMemoryProcessingQueue } from "../queue/inMemoryProcessingQueue.js";
import { logger } from "../logging/logger.js";

/**
 * Responde 200 apenas se acepta el update (ya pasó `verifySecretToken`),
 * ANTES de procesarlo (historia 2.3, AC #1/#2) — así Telegram nunca ve un
 * timeout aunque el procesamiento (echo, futura lógica de negocio) tarde o
 * lleguen varios updates a la vez. El procesamiento real se desacopla del
 * ciclo request/response vía `InMemoryProcessingQueue`; un error ahí ya no
 * puede tocar la respuesta HTTP (AC #4), solo se loggea.
 */
export function createTelegramWebhookHandler(bot: Bot): RequestHandler {
  registerEchoHandler(bot);

  const queue = new InMemoryProcessingQueue<Update>(
    (update) => bot.handleUpdate(update),
    (error, update) => {
      logger.error("Error procesando update de Telegram de forma asincrona", {
        update_id: update.update_id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );

  return (req: Request, res: Response) => {
    res.sendStatus(200);
    queue.enqueue(req.body as Update);
  };
}
