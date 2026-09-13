import { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _confirmacionesPendientesParaTests,
  _resetConfirmacionesPendientesParaTests,
  registerConfirmacionCallbackHandler,
  solicitarConfirmacion,
} from "../../src/mcp/confirmacionAccionIrreversible.js";
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

async function buildInitializedBot(): Promise<Bot> {
  const bot = new Bot(FAKE_TOKEN, { botInfo: FAKE_BOT_INFO });
  await bot.init();
  return bot;
}

function callbackQueryUpdate(updateId: number, chatId: number, data: string) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      from: { id: chatId, is_bot: false as const, first_name: "Usuario" },
      chat_instance: "test-chat-instance",
      data,
      message: {
        message_id: 900 + updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private" as const },
      },
    },
  };
}

/** Extrae el callback_data de "confirmar" del teclado inline enviado. */
function dataConfirmar(sendMessageCall: unknown[]): string {
  const options = sendMessageCall[2] as { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } };
  return options.reply_markup.inline_keyboard[0]![0]!.callback_data;
}

function dataCancelar(sendMessageCall: unknown[]): string {
  const options = sendMessageCall[2] as { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } };
  return options.reply_markup.inline_keyboard[0]![1]!.callback_data;
}

describe("solicitarConfirmacion + registerConfirmacionCallbackHandler", () => {
  let bot: Bot;
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;
  let editMessageTextSpy: ReturnType<typeof vi.spyOn>;
  let answerCallbackQuerySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    _resetConfirmacionesPendientesParaTests();
    bot = await buildInitializedBot();
    sendMessageSpy = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({} as never);
    editMessageTextSpy = vi.spyOn(bot.api, "editMessageText").mockResolvedValue(true as never);
    answerCallbackQuerySpy = vi.spyOn(bot.api, "answerCallbackQuery").mockResolvedValue(true as never);
    registerConfirmacionCallbackHandler(bot);
  });

  it("envía el resumen con botones Sí/Cancelar y NO ejecuta la acción todavía (AC #3)", async () => {
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #42 (almuerzo, 20000)", ejecutar);

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).toContain("Borrar la transacción #42 (almuerzo, 20000)");
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("el mensaje de confirmación nunca contiene JSON crudo ni la palabra PAT/token (AC #5)", async () => {
    await solicitarConfirmacion(bot, 555, "Borrar la cuenta 'Ahorros'", vi.fn());
    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).not.toMatch(/[{}[\]]/);
    expect((mensaje as string).toLowerCase()).not.toContain("pat");
    expect((mensaje as string).toLowerCase()).not.toContain("token");
  });

  it("ejecuta la acción solo después de que el usuario confirma con el botón (AC #3, #4)", async () => {
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #42", ejecutar);
    const data = dataConfirmar(sendMessageSpy.mock.calls[0]!);

    await bot.handleUpdate(callbackQueryUpdate(1, 555, data));

    expect(ejecutar).toHaveBeenCalledTimes(1);
    const [, , texto] = editMessageTextSpy.mock.calls[0]!;
    expect(texto).toContain("confirmada y ejecutada");
  });

  it("cancela sin ejecutar nunca la acción si el usuario toca 'Cancelar' (AC #4)", async () => {
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #42", ejecutar);
    const data = dataCancelar(sendMessageSpy.mock.calls[0]!);

    await bot.handleUpdate(callbackQueryUpdate(2, 555, data));

    expect(ejecutar).not.toHaveBeenCalled();
    const [, , texto] = editMessageTextSpy.mock.calls[0]!;
    expect(texto).toContain("cancelada");
  });

  it("una confirmación ya resuelta no se puede volver a usar (no cruza acciones)", async () => {
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #42", ejecutar);
    const data = dataConfirmar(sendMessageSpy.mock.calls[0]!);

    await bot.handleUpdate(callbackQueryUpdate(3, 555, data));
    await bot.handleUpdate(callbackQueryUpdate(4, 555, data));

    expect(ejecutar).toHaveBeenCalledTimes(1);
    const ultimaLlamada = answerCallbackQuerySpy.mock.calls.at(-1)!;
    const [, opciones] = ultimaLlamada as [string, { text?: string }];
    expect(opciones.text).toContain("ya no es válida");
  });

  it("dos confirmaciones pendientes simultáneas del mismo chat_id no se cruzan (edge case)", async () => {
    const ejecutarA = vi.fn().mockResolvedValue(undefined);
    const ejecutarB = vi.fn().mockResolvedValue(undefined);
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #1", ejecutarA);
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #2", ejecutarB);

    const dataA = dataConfirmar(sendMessageSpy.mock.calls[0]!);
    const dataB = dataCancelar(sendMessageSpy.mock.calls[1]!);

    await bot.handleUpdate(callbackQueryUpdate(5, 555, dataA));
    await bot.handleUpdate(callbackQueryUpdate(6, 555, dataB));

    expect(ejecutarA).toHaveBeenCalledTimes(1);
    expect(ejecutarB).not.toHaveBeenCalled();
  });

  it("si la acción confirmada falla al ejecutarse, informa el fallo sin dejarlo en silencio y lo loggea (edge case)", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const ejecutar = vi.fn().mockRejectedValue(new Error("la transacción ya no existe"));
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #42", ejecutar);
    const data = dataConfirmar(sendMessageSpy.mock.calls[0]!);

    await bot.handleUpdate(callbackQueryUpdate(7, 555, data));

    expect(errorSpy).toHaveBeenCalled();
    const [, , texto] = editMessageTextSpy.mock.calls[0]!;
    expect(texto).toContain("falló al ejecutarse");
  });

  it("no deja confirmaciones pendientes colgadas en memoria una vez resueltas", async () => {
    await solicitarConfirmacion(bot, 555, "Borrar la transacción #42", vi.fn().mockResolvedValue(undefined));
    const antes = _confirmacionesPendientesParaTests();
    const data = dataConfirmar(sendMessageSpy.mock.calls[0]!);

    await bot.handleUpdate(callbackQueryUpdate(8, 555, data));

    expect(antes).toBe(1);
    expect(_confirmacionesPendientesParaTests()).toBe(0);
  });
});
