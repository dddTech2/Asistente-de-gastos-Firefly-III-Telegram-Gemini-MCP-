import express from "express";
import { Bot } from "grammy";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/lib/logger.js";
import { createTelegramWebhookHandler } from "../../src/webhook/telegramWebhook.js";
import { createNeverCalledFireflyClient } from "../helpers/fakeFireflyClient.js";
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
  app.post(
    "/webhook/telegram",
    createTelegramWebhookHandler(bot, createAllowAllRepository(), createNeverCalledFireflyClient()),
  );
  return { app, bot };
}

describe("logging estructurado del webhook (historia 8.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loggea la recepción del webhook con update_id y chat_id (AC #1, #2)", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const { app, bot } = await buildApp();
    vi.spyOn(bot, "handleUpdate").mockResolvedValue(undefined);

    await request(app).post("/webhook/telegram").send(textUpdate(42, 555, "hola"));

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ update_id: 42, chat_id: 555 }),
      "Webhook de Telegram recibido",
    );
  });

  it("loggea el update desencolado y procesado, correlacionado por update_id (AC #1, #2)", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const { app, bot } = await buildApp();
    vi.spyOn(bot, "handleUpdate").mockResolvedValue(undefined);

    await request(app).post("/webhook/telegram").send(textUpdate(43, 556, "hola"));
    await delay(10);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ update_id: 43, chat_id: 556 }),
      "Procesando update desencolado",
    );
  });

  it("loggea un error del procesamiento asíncrono con nivel error, contexto y stack trace (AC #1, #2, #4)", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { app, bot } = await buildApp();
    vi.spyOn(bot, "handleUpdate").mockRejectedValue(new Error("fallo simulado"));

    const response = await request(app).post("/webhook/telegram").send(textUpdate(9, 777, "hola"));
    expect(response.status).toBe(200);

    await delay(10);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [context, message] = errorSpy.mock.calls[0];
    expect(message).toBe("Error procesando update de Telegram de forma asincrona");
    expect(context).toMatchObject({ update_id: 9, chat_id: 777 });
    expect((context as { err: Error }).err).toBeInstanceOf(Error);
    expect((context as { err: Error }).err.message).toBe("fallo simulado");
  });

  it("no rompe el logging cuando el update no trae chat_id reconocible (edge case)", async () => {
    const { app, bot } = await buildApp();
    vi.spyOn(bot, "handleUpdate").mockResolvedValue(undefined);

    const response = await request(app).post("/webhook/telegram").send({ update_id: 1 });

    expect(response.status).toBe(200);
  });
});
