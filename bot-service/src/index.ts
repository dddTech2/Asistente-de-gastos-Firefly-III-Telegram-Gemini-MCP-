import { env } from "./config/env.js";
import { createServer } from "./server.js";

const app = await createServer({
  botToken: env.telegramBotToken,
  webhookSecret: env.telegramWebhookSecret,
  webhookPath: env.webhookPath,
});

app.listen(env.port, () => {
  console.log(`Bot Service escuchando en el puerto ${env.port} (webhook: ${env.webhookPath})`);
});
