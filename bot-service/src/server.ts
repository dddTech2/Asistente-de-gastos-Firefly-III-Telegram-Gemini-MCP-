import express, { type Express } from "express";
import { Bot } from "grammy";
import type { CredentialResolver } from "./auth/credential-resolver.js";
import type { HistoryStore } from "./conversation/historyStore.js";
import type { UsuariosRepository } from "./db/usuarios.repository.js";
import type { GeminiClient } from "./gemini/geminiClient.js";
import { createMessageOrchestrator } from "./handlers/messageOrchestrator.js";
import { registerConfirmacionCallbackHandler, solicitarConfirmacion } from "./mcp/confirmacionAccionIrreversible.js";
import type { McpToolExecutor } from "./mcp/mcpToolExecutor.js";
import type { FireflyClient } from "./services/firefly-client.js";
import { sendTelegramMessage } from "./telegram/sendMessage.js";
import { createTelegramWebhookHandler } from "./webhook/telegramWebhook.js";
import { createVerifySecretToken } from "./webhook/verifySecretToken.js";

export interface ServerOptions {
  botToken: string;
  webhookSecret: string;
  webhookPath: string;
  usuariosRepository: UsuariosRepository;
  fireflyClient: FireflyClient;
  geminiClient: GeminiClient;
  mcpToolExecutor: McpToolExecutor;
  historyStore: HistoryStore;
  credentialResolver: CredentialResolver;
}

/**
 * Historia 5.14: `confirmador`/`enviarMensaje` del orquestador necesitan el
 * `bot` real (para `solicitarConfirmacion`/`sendTelegramMessage`), que recién
 * existe acá adentro -- por eso `messageOrchestrator` se arma en `server.ts`
 * y no en `index.ts` (que solo construye las piezas que no dependen de
 * `grammy`). `registerConfirmacionCallbackHandler` (historia 4.3, construido
 * pero nunca registrado hasta esta historia) también se registra acá, una
 * sola vez por `bot`.
 */
export async function createServer(options: ServerOptions): Promise<Express> {
  const bot = new Bot(options.botToken);
  // grammY exige inicializar el bot (trae botInfo vía getMe) antes de poder
  // usar handleUpdate — si no, cada request fallaría con "Bot not initialized!"
  // y el catch de telegramWebhook lo enmascararía como un 200 silencioso.
  await bot.init();

  registerConfirmacionCallbackHandler(bot);

  const messageOrchestrator = createMessageOrchestrator({
    geminiClient: options.geminiClient,
    mcpToolExecutor: options.mcpToolExecutor,
    historyStore: options.historyStore,
    credentialResolver: options.credentialResolver,
    confirmador: {
      solicitarConfirmacion: (chatId, resumenAccion, ejecutar) =>
        solicitarConfirmacion(bot, chatId, resumenAccion, ejecutar),
    },
    enviarMensaje: (chatId, texto) => sendTelegramMessage(bot, chatId, texto),
  });

  const app = express();

  app.use(express.json());

  app.post(
    options.webhookPath,
    createVerifySecretToken(options.webhookSecret),
    createTelegramWebhookHandler(bot, options.usuariosRepository, options.fireflyClient, messageOrchestrator),
  );

  return app;
}
