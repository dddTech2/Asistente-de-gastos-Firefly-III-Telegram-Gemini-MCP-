import { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatEchoReply, registerEchoHandler } from "../../src/handlers/echoHandler.js";

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

function stickerUpdate(updateId: number, chatId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" as const },
      from: { id: chatId, is_bot: false, first_name: "Usuario" },
      sticker: {
        file_id: "sticker-file-id",
        file_unique_id: "sticker-unique-id",
        width: 512,
        height: 512,
        is_animated: false,
        is_video: false,
      },
    },
  };
}

async function buildInitializedBot(): Promise<Bot> {
  const bot = new Bot(FAKE_TOKEN, { botInfo: FAKE_BOT_INFO });
  await bot.init();
  return bot;
}

describe("formatEchoReply", () => {
  it("envuelve el texto recibido en un mensaje de confirmación", () => {
    expect(formatEchoReply("hola")).toBe('Recibido: "hola"');
  });
});

describe("registerEchoHandler", () => {
  let bot: Bot;
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    bot = await buildInitializedBot();
    sendMessageSpy = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({} as never);
    registerEchoHandler(bot);
  });

  it("responde al chat_id correcto con el eco del mensaje de texto (AC #1, #2)", async () => {
    await bot.handleUpdate(textUpdate(1, 555, "gasté 20 mil en almuerzo"));

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).toHaveBeenCalledWith(555, 'Recibido: "gasté 20 mil en almuerzo"');
  });

  it("no rompe ni responde ante un update sin texto, ej. un sticker (AC #3)", async () => {
    await expect(bot.handleUpdate(stickerUpdate(2, 555))).resolves.not.toThrow();

    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("responde a cada chat por separado sin cruzar respuestas", async () => {
    await bot.handleUpdate(textUpdate(3, 111, "mensaje de A"));
    await bot.handleUpdate(textUpdate(4, 222, "mensaje de B"));

    expect(sendMessageSpy).toHaveBeenCalledTimes(2);
    expect(sendMessageSpy).toHaveBeenNthCalledWith(1, 111, 'Recibido: "mensaje de A"');
    expect(sendMessageSpy).toHaveBeenNthCalledWith(2, 222, 'Recibido: "mensaje de B"');
  });
});
