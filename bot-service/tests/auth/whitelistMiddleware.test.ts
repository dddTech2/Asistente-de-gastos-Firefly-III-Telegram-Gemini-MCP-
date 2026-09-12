import { Bot } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWhitelistMiddleware } from "../../src/auth/whitelistMiddleware.js";
import type { UsuariosRepository } from "../../src/db/usuarios.repository.js";
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

function buildRepository(findByChatId: UsuariosRepository["findByChatId"]): UsuariosRepository {
  return {
    findByChatId,
    crear: vi.fn().mockResolvedValue(undefined),
    guardarPatCifrado: vi.fn().mockResolvedValue(undefined),
    obtenerPatDescifrado: vi.fn().mockResolvedValue(null),
  };
}

async function buildBot(repository: UsuariosRepository) {
  const bot = new Bot(FAKE_TOKEN, { botInfo: FAKE_BOT_INFO });
  await bot.init();
  const sendMessageSpy = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({} as never);
  const downstreamSpy = vi.fn();

  bot.use(createWhitelistMiddleware(bot, repository));
  bot.on("message:text", (_ctx) => {
    downstreamSpy();
  });

  return { bot, sendMessageSpy, downstreamSpy };
}

describe("createWhitelistMiddleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bloquea un chat_id no registrado: responde 'no autorizado' y no llega al resto del pipeline (AC #2, #4)", async () => {
    const repository = buildRepository(vi.fn().mockResolvedValue(null));
    const { bot, sendMessageSpy, downstreamSpy } = await buildBot(repository);

    await bot.handleUpdate(textUpdate(1, 999, "hola"));

    expect(downstreamSpy).not.toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledWith(999, expect.stringContaining("No autorizado"));
  });

  it("bloquea un chat_id registrado pero inactivo (AC #2)", async () => {
    const repository = buildRepository(vi.fn().mockResolvedValue({ chatId: 999, activo: false }));
    const { bot, sendMessageSpy, downstreamSpy } = await buildBot(repository);

    await bot.handleUpdate(textUpdate(2, 999, "hola"));

    expect(downstreamSpy).not.toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("deja pasar un chat_id activo hacia el resto del pipeline, sin responder 'no autorizado' (AC #3)", async () => {
    const repository = buildRepository(vi.fn().mockResolvedValue({ chatId: 555, activo: true }));
    const { bot, sendMessageSpy, downstreamSpy } = await buildBot(repository);

    await bot.handleUpdate(textUpdate(3, 555, "hola"));

    expect(downstreamSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("falla cerrado si la consulta a la whitelist lanza una excepción: no deja pasar ni rompe el proceso (edge case)", async () => {
    const repository = buildRepository(vi.fn().mockRejectedValue(new Error("conexion perdida")));
    const { bot, downstreamSpy } = await buildBot(repository);

    await expect(bot.handleUpdate(textUpdate(4, 555, "hola"))).resolves.not.toThrow();

    expect(downstreamSpy).not.toHaveBeenCalled();
  });

  it("descarta sin lanzar un update sin chat_id identificable (edge case)", async () => {
    const repository = buildRepository(vi.fn());
    const { bot, downstreamSpy } = await buildBot(repository);

    await expect(bot.handleUpdate({ update_id: 5 })).resolves.not.toThrow();

    expect(downstreamSpy).not.toHaveBeenCalled();
    expect(repository.findByChatId).not.toHaveBeenCalled();
  });

  it("loggea el intento con chat_id y el resultado, sin exponer el texto del mensaje (AC #5)", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const repository = buildRepository(vi.fn().mockResolvedValue({ chatId: 555, activo: true }));
    const { bot } = await buildBot(repository);

    await bot.handleUpdate(textUpdate(6, 555, "un mensaje con datos sensibles"));

    const whitelistLogCall = infoSpy.mock.calls.find(([, message]) => message === "Intento de acceso evaluado por la whitelist");
    expect(whitelistLogCall).toBeDefined();
    const [context] = whitelistLogCall!;
    expect(context).toEqual({ chat_id: 555, autorizado: true });
  });
});
