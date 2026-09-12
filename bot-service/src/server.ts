import express, { type Express } from "express";
import { Bot } from "grammy";
import type { UsuariosRepository } from "./db/usuarios.repository.js";
import { createTelegramWebhookHandler } from "./webhook/telegramWebhook.js";
import { createVerifySecretToken } from "./webhook/verifySecretToken.js";

export interface ServerOptions {
  botToken: string;
  webhookSecret: string;
  webhookPath: string;
  usuariosRepository: UsuariosRepository;
}

export async function createServer(options: ServerOptions): Promise<Express> {
  const bot = new Bot(options.botToken);
  // grammY exige inicializar el bot (trae botInfo vía getMe) antes de poder
  // usar handleUpdate — si no, cada request fallaría con "Bot not initialized!"
  // y el catch de telegramWebhook lo enmascararía como un 200 silencioso.
  await bot.init();

  const app = express();

  app.use(express.json());

  app.post(
    options.webhookPath,
    createVerifySecretToken(options.webhookSecret),
    createTelegramWebhookHandler(bot, options.usuariosRepository),
  );

  return app;
}
