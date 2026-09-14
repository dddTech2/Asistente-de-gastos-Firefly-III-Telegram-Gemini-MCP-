import { createCredentialResolver } from "./auth/credential-resolver.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { createUsoTokensGeminiRepository } from "./db/usoTokensGemini.repository.js";
import { createUsuariosRepository } from "./db/usuarios.repository.js";
import { createHistoryStore } from "./conversation/historyStore.js";
import { createGeminiClient } from "./gemini/geminiClient.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redisClient.js";
import { createMcpToolExecutor } from "./mcp/mcpToolExecutor.js";
import { createServer } from "./server.js";
import { createFireflyClient } from "./services/firefly-client.js";

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
const fireflyClient = createFireflyClient({
  baseUrl: env.fireflyBaseUrl,
  pat: env.fireflyPat,
  sourceAccount: env.fireflySourceAccount,
});

// Historia 5.13: piezas del pipeline de Gemini para mensajes de texto libre
// -- ya existían standalone desde la historia 5.1, esta es la primera vez
// que se instancian con configuración real del proceso. `server.ts` (5.14)
// es quien arma el `messageOrchestrator` final, porque necesita el `bot` de
// grammY (que no existe hasta ahí) para el confirmador de acciones
// irreversibles.
const app = await createServer({
  botToken: env.telegramBotToken,
  webhookSecret: env.telegramWebhookSecret,
  webhookPath: env.webhookPath,
  usuariosRepository,
  fireflyClient,
  geminiClient: createGeminiClient(env.geminiApiKey, env.geminiModel),
  mcpToolExecutor: createMcpToolExecutor(env.mcpFireflyUrl),
  historyStore: createHistoryStore(redis),
  credentialResolver: createCredentialResolver({ usuariosRepository, fireflyUrl: env.fireflyBaseUrl }),
  usoTokensGeminiRepository: createUsoTokensGeminiRepository(pool),
});

app.listen(env.port, () => {
  logger.info({ port: env.port, webhookPath: env.webhookPath }, "Bot Service escuchando");
});
