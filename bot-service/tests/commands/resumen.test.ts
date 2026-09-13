import { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calcularRangoMesActual, formatMensajeResumen, registerResumenHandler } from "../../src/commands/resumen.js";
import { logger } from "../../src/lib/logger.js";
import { FireflyClientError, type FireflyClient, type TransaccionResumen } from "../../src/services/firefly-client.js";

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

function comandoUpdate(updateId: number, chatId: number, texto: string) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" as const },
      from: { id: chatId, is_bot: false, first_name: "Usuario" },
      text: texto,
      entities: [{ type: "bot_command" as const, offset: 0, length: "/resumen".length }],
    },
  };
}

async function buildInitializedBot(): Promise<Bot> {
  const bot = new Bot(FAKE_TOKEN, { botInfo: FAKE_BOT_INFO });
  await bot.init();
  return bot;
}

function buildFireflyClient(listarTransacciones: FireflyClient["listarTransacciones"]): FireflyClient {
  return { crearTransaccion: vi.fn(), listarTransacciones };
}

describe("calcularRangoMesActual", () => {
  it("devuelve el primer día del mes en curso y hoy (edge case: primer día del mes)", () => {
    expect(calcularRangoMesActual(new Date(2026, 8, 1))).toEqual({ desde: "2026-09-01", hasta: "2026-09-01" });
  });

  it("devuelve el rango completo hasta un día cualquiera del mes", () => {
    expect(calcularRangoMesActual(new Date(2026, 8, 13))).toEqual({ desde: "2026-09-01", hasta: "2026-09-13" });
  });
});

describe("formatMensajeResumen", () => {
  it("informa que no hay movimientos si la lista está vacía (AC #3)", () => {
    expect(formatMensajeResumen([])).toMatch(/no hay movimientos/i);
  });

  it("incluye fecha, monto y concepto de cada transacción (AC #2)", () => {
    const transacciones: TransaccionResumen[] = [
      { fecha: "2026-09-05T00:00:00+00:00", monto: "20000", concepto: "almuerzo" },
      { fecha: "2026-09-06T00:00:00+00:00", monto: "5000", concepto: "cafe" },
    ];
    const mensaje = formatMensajeResumen(transacciones);
    expect(mensaje).toContain("2026-09-05");
    expect(mensaje).toContain("20000");
    expect(mensaje).toContain("almuerzo");
    expect(mensaje).toContain("2026-09-06");
    expect(mensaje).toContain("5000");
    expect(mensaje).toContain("cafe");
  });
});

describe("registerResumenHandler", () => {
  let bot: Bot;
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    bot = await buildInitializedBot();
    sendMessageSpy = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({} as never);
  });

  it("consulta Firefly y responde la lista de transacciones del mes (AC #1, #2)", async () => {
    const listarTransacciones = vi
      .fn()
      .mockResolvedValue([{ fecha: "2026-09-05T00:00:00+00:00", monto: "20000", concepto: "almuerzo" }]);
    registerResumenHandler(bot, buildFireflyClient(listarTransacciones));

    await bot.handleUpdate(comandoUpdate(1, 555, "/resumen"));

    expect(listarTransacciones).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).toContain("almuerzo");
  });

  it("informa que no hay movimientos si el mes está vacío (AC #3)", async () => {
    const listarTransacciones = vi.fn().mockResolvedValue([]);
    registerResumenHandler(bot, buildFireflyClient(listarTransacciones));

    await bot.handleUpdate(comandoUpdate(2, 555, "/resumen"));

    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).toMatch(/no hay movimientos/i);
  });

  it("informa un fallo genérico sin detalles técnicos si Firefly responde error (AC #4)", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const listarTransacciones = vi
      .fn()
      .mockRejectedValue(new FireflyClientError("Firefly III respondió 500 al listar transacciones", 500));
    registerResumenHandler(bot, buildFireflyClient(listarTransacciones));

    await bot.handleUpdate(comandoUpdate(3, 555, "/resumen"));

    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).not.toContain("500");
    expect(mensaje).not.toContain("Firefly");
    expect(mensaje).toMatch(/no se pudo obtener/i);
  });

  it("informa un fallo genérico ante un timeout de Firefly, sin dejarlo en silencio (AC #4)", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const listarTransacciones = vi
      .fn()
      .mockRejectedValue(new FireflyClientError("Firefly III no respondió a tiempo"));
    registerResumenHandler(bot, buildFireflyClient(listarTransacciones));

    await bot.handleUpdate(comandoUpdate(4, 555, "/resumen"));

    expect(errorSpy).toHaveBeenCalled();
    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).toMatch(/no se pudo obtener/i);
  });

  it("el log de error nunca incluye el PAT ni el objeto FireflyClient, solo chat_id + err", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const listarTransacciones = vi
      .fn()
      .mockRejectedValue(new FireflyClientError("Firefly III respondió 401", 401));
    registerResumenHandler(bot, buildFireflyClient(listarTransacciones));

    await bot.handleUpdate(comandoUpdate(5, 555, "/resumen"));

    const [context] = errorSpy.mock.calls[0]!;
    expect(Object.keys(context as object).sort()).toEqual(["chat_id", "err"]);
  });

  it("no interfiere con otros chat_id (no cruza respuestas)", async () => {
    const listarTransacciones = vi
      .fn()
      .mockResolvedValueOnce([{ fecha: "2026-09-01", monto: "100", concepto: "cafe" }])
      .mockResolvedValueOnce([{ fecha: "2026-09-02", monto: "200", concepto: "taxi" }]);
    registerResumenHandler(bot, buildFireflyClient(listarTransacciones));

    await bot.handleUpdate(comandoUpdate(6, 111, "/resumen"));
    await bot.handleUpdate(comandoUpdate(7, 222, "/resumen"));

    expect(sendMessageSpy).toHaveBeenNthCalledWith(1, 111, expect.stringContaining("cafe"));
    expect(sendMessageSpy).toHaveBeenNthCalledWith(2, 222, expect.stringContaining("taxi"));
  });
});
