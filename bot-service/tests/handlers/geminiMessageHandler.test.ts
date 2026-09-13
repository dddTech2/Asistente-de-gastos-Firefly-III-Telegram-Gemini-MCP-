import { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredencialesNoDisponiblesError } from "../../src/auth/credential-resolver.js";
import { registerGeminiMessageHandler } from "../../src/handlers/geminiMessageHandler.js";
import type { MessageOrchestrator } from "../../src/handlers/messageOrchestrator.js";
import { logger } from "../../src/lib/logger.js";

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

describe("registerGeminiMessageHandler (historia 5.13)", () => {
  let bot: Bot;
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;
  let procesarMensaje: ReturnType<typeof vi.fn>;
  let messageOrchestrator: MessageOrchestrator;

  beforeEach(async () => {
    bot = await buildInitializedBot();
    sendMessageSpy = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({} as never);
    procesarMensaje = vi.fn();
    messageOrchestrator = { procesarMensaje };
    registerGeminiMessageHandler(bot, messageOrchestrator);
  });

  it("procesa el mensaje con el orquestador y envía la respuesta tal cual (AC #1)", async () => {
    procesarMensaje.mockResolvedValue("Gastaste 20.000 ARS en Comida este mes.");

    await bot.handleUpdate(textUpdate(1, 555, "¿cuánto gasté en comida este mes?"));

    expect(procesarMensaje).toHaveBeenCalledWith(555, "¿cuánto gasté en comida este mes?");
    expect(sendMessageSpy).toHaveBeenCalledWith(555, "Gastaste 20.000 ARS en Comida este mes.");
  });

  it("sin credenciales disponibles, responde con un mensaje claro de alta pendiente, no un error técnico (AC #3)", async () => {
    procesarMensaje.mockRejectedValue(new CredencialesNoDisponiblesError(555));
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await bot.handleUpdate(textUpdate(2, 555, "hola"));

    expect(sendMessageSpy).toHaveBeenCalledWith(
      555,
      "Todavía no tenés una cuenta vinculada. Pedile a un administrador que te dé de alta antes de poder usar el asistente.",
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("ante una excepción genérica, responde con un fallback y loguea el error con chat_id (AC #4)", async () => {
    procesarMensaje.mockRejectedValue(new Error("timeout de red"));
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    await bot.handleUpdate(textUpdate(3, 555, "hola"));

    expect(sendMessageSpy).toHaveBeenCalledWith(555, "No pude procesar tu mensaje. Probá de nuevo en un momento.");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [context] = errorSpy.mock.calls[0]!;
    expect(context).toMatchObject({ chat_id: 555 });
  });

  it("cuando el orquestador devuelve null (confirmación de acción irreversible ya enviada, historia 5.14), no envía nada más", async () => {
    procesarMensaje.mockResolvedValue(null);

    await bot.handleUpdate(textUpdate(7, 555, "borrá la transacción 42"));

    expect(procesarMensaje).toHaveBeenCalledWith(555, "borrá la transacción 42");
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("no rompe ni responde ante un update sin texto, ej. un sticker", async () => {
    await expect(bot.handleUpdate(stickerUpdate(4, 555))).resolves.not.toThrow();

    expect(procesarMensaje).not.toHaveBeenCalled();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("responde a cada chat por separado sin cruzar respuestas", async () => {
    procesarMensaje.mockResolvedValueOnce("respuesta para A").mockResolvedValueOnce("respuesta para B");

    await bot.handleUpdate(textUpdate(5, 111, "mensaje de A"));
    await bot.handleUpdate(textUpdate(6, 222, "mensaje de B"));

    expect(sendMessageSpy).toHaveBeenNthCalledWith(1, 111, "respuesta para A");
    expect(sendMessageSpy).toHaveBeenNthCalledWith(2, 222, "respuesta para B");
  });
});
