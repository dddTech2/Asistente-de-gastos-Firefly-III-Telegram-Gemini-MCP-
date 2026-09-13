import { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMensajeExito, parsearArgumentosGasto, registerGastoHandler } from "../../src/commands/gasto.js";
import { logger } from "../../src/lib/logger.js";
import { FireflyClientError, type FireflyClient } from "../../src/services/firefly-client.js";

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
      entities: [{ type: "bot_command" as const, offset: 0, length: "/gasto".length }],
    },
  };
}

async function buildInitializedBot(): Promise<Bot> {
  const bot = new Bot(FAKE_TOKEN, { botInfo: FAKE_BOT_INFO });
  await bot.init();
  return bot;
}

function buildFireflyClient(crearTransaccion: FireflyClient["crearTransaccion"]): FireflyClient {
  return { crearTransaccion };
}

describe("parsearArgumentosGasto", () => {
  it("parsea monto y concepto válidos (AC #1)", () => {
    expect(parsearArgumentosGasto("20000 almuerzo")).toEqual({ monto: 20000, concepto: "almuerzo" });
  });

  it("acepta un concepto de varias palabras", () => {
    expect(parsearArgumentosGasto("15000 almuerzo con papas")).toEqual({
      monto: 15000,
      concepto: "almuerzo con papas",
    });
  });

  it("acepta montos con decimales", () => {
    expect(parsearArgumentosGasto("2500.50 cafe")).toEqual({ monto: 2500.5, concepto: "cafe" });
  });

  it("rechaza sin argumentos (AC #2)", () => {
    expect(parsearArgumentosGasto("")).toBeNull();
  });

  it("rechaza sin concepto (solo el monto) (AC #2)", () => {
    expect(parsearArgumentosGasto("20000")).toBeNull();
  });

  it("rechaza un monto no numérico (AC #2)", () => {
    expect(parsearArgumentosGasto("veinte almuerzo")).toBeNull();
  });

  it("rechaza monto cero (edge case)", () => {
    expect(parsearArgumentosGasto("0 almuerzo")).toBeNull();
  });

  it("rechaza monto negativo (edge case)", () => {
    expect(parsearArgumentosGasto("-500 almuerzo")).toBeNull();
  });

  it("rechaza concepto vacío o solo espacios (edge case)", () => {
    expect(parsearArgumentosGasto("20000    ")).toBeNull();
  });
});

describe("formatMensajeExito", () => {
  it("incluye monto, concepto e id de la transacción (AC #4)", () => {
    const mensaje = formatMensajeExito({ monto: 20000, concepto: "almuerzo" }, "42");
    expect(mensaje).toContain("20000");
    expect(mensaje).toContain("almuerzo");
    expect(mensaje).toContain("42");
  });
});

describe("registerGastoHandler", () => {
  let bot: Bot;
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    bot = await buildInitializedBot();
    sendMessageSpy = vi.spyOn(bot.api, "sendMessage").mockResolvedValue({} as never);
  });

  it("crea la transacción en Firefly y confirma monto/concepto (AC #1, #4)", async () => {
    const crearTransaccion = vi.fn().mockResolvedValue({ id: "42" });
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(1, 555, "/gasto 20000 almuerzo"));

    expect(crearTransaccion).toHaveBeenCalledWith({ monto: 20000, concepto: "almuerzo" });
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).toContain("20000");
    expect(mensaje).toContain("almuerzo");
    expect(mensaje).toContain("42");
  });

  it("responde el mensaje de uso y NO llama a Firefly si faltan argumentos (AC #2)", async () => {
    const crearTransaccion = vi.fn();
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(2, 555, "/gasto"));

    expect(crearTransaccion).not.toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledWith(555, expect.stringContaining("Uso:"));
  });

  it("responde el mensaje de uso y NO llama a Firefly si el monto no es numérico (AC #2)", async () => {
    const crearTransaccion = vi.fn();
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(3, 555, "/gasto veinte almuerzo"));

    expect(crearTransaccion).not.toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledWith(555, expect.stringContaining("Uso:"));
  });

  it("informa un fallo genérico sin detalles técnicos si Firefly responde error (AC #3)", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const crearTransaccion = vi.fn().mockRejectedValue(new FireflyClientError("Firefly III respondió 422", 422));
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(4, 555, "/gasto 20000 almuerzo"));

    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).not.toContain("422");
    expect(mensaje).not.toContain("Firefly");
    expect(mensaje).toMatch(/no se pudo registrar/i);
  });

  it("informa un fallo genérico ante un timeout de Firefly, sin dejarlo en silencio (AC #3)", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const crearTransaccion = vi.fn().mockRejectedValue(new FireflyClientError("Firefly III no respondió a tiempo"));
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(5, 555, "/gasto 20000 almuerzo"));

    expect(errorSpy).toHaveBeenCalled();
    const [, mensaje] = sendMessageSpy.mock.calls[0]!;
    expect(mensaje).toMatch(/no se pudo registrar/i);
  });

  it("el log de error nunca incluye el PAT ni el objeto FireflyClient, solo chat_id + err (AC #6)", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const crearTransaccion = vi.fn().mockRejectedValue(new FireflyClientError("Firefly III respondió 401", 401));
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(6, 555, "/gasto 20000 almuerzo"));

    const [context] = errorSpy.mock.calls[0]!;
    expect(Object.keys(context as object).sort()).toEqual(["chat_id", "err"]);
  });

  it("no interfiere con otros chat_id (no cruza respuestas)", async () => {
    const crearTransaccion = vi.fn().mockResolvedValue({ id: "1" });
    registerGastoHandler(bot, buildFireflyClient(crearTransaccion));

    await bot.handleUpdate(comandoUpdate(7, 111, "/gasto 100 cafe"));
    await bot.handleUpdate(comandoUpdate(8, 222, "/gasto 200 taxi"));

    expect(sendMessageSpy).toHaveBeenNthCalledWith(1, 111, expect.stringContaining("cafe"));
    expect(sendMessageSpy).toHaveBeenNthCalledWith(2, 222, expect.stringContaining("taxi"));
  });
});
