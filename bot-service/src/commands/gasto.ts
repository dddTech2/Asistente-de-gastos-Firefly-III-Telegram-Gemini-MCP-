import type { Bot } from "grammy";
import type { FireflyClient } from "../services/firefly-client.js";
import { logger } from "../lib/logger.js";
import { sendTelegramMessage } from "../telegram/sendMessage.js";

export interface ArgumentosGasto {
  monto: number;
  concepto: string;
}

const MENSAJE_USO = "Uso: /gasto <monto> <concepto>  (ejemplo: /gasto 20000 almuerzo)";
const MENSAJE_ERROR_GENERICO = "No se pudo registrar el gasto. Intentá de nuevo en un momento.";

/**
 * Formato esperado: monto numérico plano (acepta decimales, ej. `20000` o
 * `20000.50`), seguido del concepto. No interpreta separadores de miles al
 * estilo argentino -- `20.000` se lee como `20`, no como veinte mil (mismo
 * formato del ejemplo del propio AC #1: `/gasto 20000 almuerzo`). [Inference]
 */
export function parsearArgumentosGasto(textoArgumentos: string): ArgumentosGasto | null {
  const texto = textoArgumentos.trim();
  const primerEspacio = texto.indexOf(" ");
  if (primerEspacio === -1) {
    return null;
  }

  const montoTexto = texto.slice(0, primerEspacio);
  const concepto = texto.slice(primerEspacio + 1).trim();
  const monto = Number(montoTexto);

  if (!Number.isFinite(monto) || monto <= 0 || concepto === "") {
    return null;
  }

  return { monto, concepto };
}

export function formatMensajeExito({ monto, concepto }: ArgumentosGasto, transaccionId: string): string {
  return `✅ Gasto registrado: ${monto} — ${concepto} (id ${transaccionId})`;
}

/**
 * Debe registrarse ANTES que `registerEchoHandler` en el pipeline del
 * webhook (historia 2.2): un `bot.command` que no llama a `next()` corta la
 * cadena, así el eco no vuelve a responder al mismo update de `/gasto`.
 *
 * El PAT vive únicamente dentro de `fireflyClient` (ya construido e
 * inyectado por quien arma el servidor) -- este handler nunca lo ve ni lo
 * loggea, y el `catch` solo loggea `chat_id` + el error de
 * `FireflyClientError`, nunca el PAT (AC #6).
 */
export function registerGastoHandler(bot: Bot, fireflyClient: FireflyClient): void {
  bot.command("gasto", async (ctx) => {
    const argumentos = parsearArgumentosGasto(ctx.match);

    if (!argumentos) {
      await sendTelegramMessage(bot, ctx.chat.id, MENSAJE_USO);
      return;
    }

    try {
      const transaccion = await fireflyClient.crearTransaccion(argumentos);
      await sendTelegramMessage(bot, ctx.chat.id, formatMensajeExito(argumentos, transaccion.id));
    } catch (error) {
      logger.error(
        { chat_id: ctx.chat.id, err: error instanceof Error ? error : new Error(String(error)) },
        "Fallo al crear la transacción en Firefly III",
      );
      await sendTelegramMessage(bot, ctx.chat.id, MENSAJE_ERROR_GENERICO);
    }
  });
}
