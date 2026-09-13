import type { Bot } from "grammy";
import type { FireflyClient, TransaccionResumen } from "../services/firefly-client.js";
import { logger } from "../lib/logger.js";
import { sendTelegramMessage } from "../telegram/sendMessage.js";

const MENSAJE_SIN_MOVIMIENTOS = "No hay movimientos registrados este mes.";
const MENSAJE_ERROR_GENERICO = "No se pudo obtener el resumen. Intentá de nuevo en un momento.";

function formatFecha(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

/**
 * "Mes en curso" = primer día del mes calendario (hora local del servidor) →
 * hoy. La zona horaria exacta del usuario no está definida en ningún
 * documento fuente de la historia (ver Dev Notes de 3.2); se usa la del
 * servidor, igual que el resto del proyecto no introduce manejo de zona
 * horaria por-usuario. [Inference]
 */
export function calcularRangoMesActual(ahora: Date = new Date()): { desde: string; hasta: string } {
  const primerDia = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  return { desde: formatFecha(primerDia), hasta: formatFecha(ahora) };
}

/**
 * Firefly III devuelve `amount` como string con precisión arbitraria (ej.
 * `"20000.00000000000000000000"`) -- se formatea a 2 decimales para mostrar.
 * Si por algún motivo no es numérico, se muestra tal cual llegó en vez de
 * ocultar el dato. [Inference]
 */
function formatMonto(monto: string): string {
  const numero = Number(monto);
  return Number.isFinite(numero) ? numero.toFixed(2) : monto;
}

export function formatMensajeResumen(transacciones: TransaccionResumen[]): string {
  if (transacciones.length === 0) {
    return MENSAJE_SIN_MOVIMIENTOS;
  }

  const lineas = transacciones.map((t) => `${t.fecha.slice(0, 10)} — ${formatMonto(t.monto)} — ${t.concepto}`);
  return ["Resumen del mes:", ...lineas].join("\n");
}

/**
 * Se registra junto a `registerGastoHandler` (historia 3.1), ANTES del eco
 * (historia 2.2), por el mismo motivo: un `bot.command` que no llama a
 * `next()` corta la cadena para ese update.
 *
 * Igual que `/gasto`, el `catch` solo loggea `chat_id` + el error, nunca el
 * PAT ni la respuesta cruda de Firefly III (AC #4).
 */
export function registerResumenHandler(bot: Bot, fireflyClient: FireflyClient): void {
  bot.command("resumen", async (ctx) => {
    const { desde, hasta } = calcularRangoMesActual();

    try {
      const transacciones = await fireflyClient.listarTransacciones(desde, hasta);
      await sendTelegramMessage(bot, ctx.chat.id, formatMensajeResumen(transacciones));
    } catch (error) {
      logger.error(
        { chat_id: ctx.chat.id, err: error instanceof Error ? error : new Error(String(error)) },
        "Fallo al obtener el resumen de transacciones de Firefly III",
      );
      await sendTelegramMessage(bot, ctx.chat.id, MENSAJE_ERROR_GENERICO);
    }
  });
}
