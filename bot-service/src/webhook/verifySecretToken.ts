import type { NextFunction, Request, RequestHandler, Response } from "express";

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Telegram no acepta el webhook solo por conocer la URL: además del secret_token
 * configurado en `setWebhook`, cada request reenvía ese mismo valor en este header.
 * Sin esta validación, cualquiera que descubra la URL podría inyectar updates falsos.
 */
export function createVerifySecretToken(expectedSecret: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const received = req.header(TELEGRAM_SECRET_HEADER);

    if (!received || received !== expectedSecret) {
      res.status(401).json({ error: "secret_token inválido o ausente" });
      return;
    }

    next();
  };
}
