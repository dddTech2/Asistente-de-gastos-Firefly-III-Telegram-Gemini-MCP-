import express from "express";
import { Bot } from "grammy";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/lib/logger.js";
import { createTelegramWebhookHandler } from "../../src/webhook/telegramWebhook.js";
import { createAllowAllRepository } from "../helpers/fakeUsuariosRepository.js";

const FAKE_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const FAKE_BOT_INFO = {
  id: 123456,
  is_bot: true as const,
  first_name: "Asistente de gastos (test)",
  username: "asistente_gastos_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

function textUpdate(updateId: number, chatId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" as const },
      from: { id: chatId, is_bot: false, first_name: "Usuario" },
      text,
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildApp() {
  const bot = new Bot(FAKE_TOKEN, { botInfo: FAKE_BOT_INFO });
  await bot.init();
  const app = express();
  app.use(express.json());
  app.post("/webhook/telegram", createTelegramWebhookHandler(bot, createAllowAllRepository()));
  return { app, bot };
}

describe("createTelegramWebhookHandler — ack inmediato + procesamiento asincrono (historia 2.3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 200 antes de que termine un procesamiento simulado lento (AC #1, #2)", async () => {
    const { app, bot } = await buildApp();
    let processingFinished = false;
    vi.spyOn(bot, "handleUpdate").mockImplementation(async () => {
      await delay(100);
      processingFinished = true;
    });

    const response = await request(app).post("/webhook/telegram").send(textUpdate(1, 555, "hola"));

    expect(response.status).toBe(200);
    expect(processingFinished).toBe(false);

    await delay(150);
    expect(processingFinished).toBe(true);
  });

  it("varios updates concurrentes de distintos chats reciben cada uno 200 sin bloquearse (AC #3)", async () => {
    const { app, bot } = await buildApp();
    vi.spyOn(bot, "handleUpdate").mockImplementation(async () => {
      await delay(50);
    });

    const responses = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        request(app)
          .post("/webhook/telegram")
          .send(textUpdate(n, 100 + n, `msg-${n}`)),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
    }
  });

  it("una excepción en el procesamiento asíncrono no afecta el ack ya enviado y queda logueada (AC #4)", async () => {
    const { app, bot } = await buildApp();
    vi.spyOn(bot, "handleUpdate").mockRejectedValue(new Error("fallo simulado"));
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const response = await request(app).post("/webhook/telegram").send(textUpdate(7, 777, "hola"));
    expect(response.status).toBe(200);

    await delay(10);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [context, message] = errorSpy.mock.calls[0];
    expect(message).toBe("Error procesando update de Telegram de forma asincrona");
    expect(context).toMatchObject({ update_id: 7, chat_id: 777 });
    expect((context as { err: Error }).err.message).toBe("fallo simulado");
  });
});
