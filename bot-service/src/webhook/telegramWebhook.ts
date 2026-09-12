import type { Request, RequestHandler, Response } from "express";
import type { Bot } from "grammy";
import { registerEchoHandler } from "../handlers/echoHandler.js";

/**
 * Siempre responde 200: Telegram reintenta el mismo update agresivamente ante
 * cualquier otro status, y un error de procesamiento interno no debe convertirse
 * en un reintento infinito. Los handlers de negocio (echo, comandos, etc. — 2.2+)
 * se registran en el `Bot` que se le inyecta a este handler.
 */
export function createTelegramWebhookHandler(bot: Bot): RequestHandler {
  registerEchoHandler(bot);

  return (req: Request, res: Response) => {
    bot
      .handleUpdate(req.body)
      .then(() => res.sendStatus(200))
      .catch((error: unknown) => {
        console.error("Error procesando update de Telegram:", error);
        res.sendStatus(200);
      });
  };
}
