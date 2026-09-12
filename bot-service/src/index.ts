import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { createUsuariosRepository } from "./db/usuarios.repository.js";
import { logger } from "./lib/logger.js";
import { createServer } from "./server.js";

/**
 * Red de seguridad para excepciones/rechazos que escapan a cualquier try/catch
 * puntual (historia 8.1, AC #1: "cualquier excepción no controlada"). No
 * termina el proceso — pm2 ya lo reinicia si hace falta; acá solo se garantiza
 * que quede un log con stack trace antes de que Node decida qué hacer.
 */
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "Excepcion no controlada (uncaughtException)");
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, "Promesa rechazada sin manejar (unhandledRejection)");
});

const usuariosRepository = createUsuariosRepository(pool, env.patEncryptionKey);

const app = await createServer({
  botToken: env.telegramBotToken,
  webhookSecret: env.telegramWebhookSecret,
  webhookPath: env.webhookPath,
  usuariosRepository,
});

app.listen(env.port, () => {
  logger.info({ port: env.port, webhookPath: env.webhookPath }, "Bot Service escuchando");
});
