/** Forma mínima relevante de la respuesta real de Firefly III a `create_transaction` (verificada en la historia 4.2: `{"data":{"attributes":{"transactions":[{...}]}}}`). */
interface TransaccionFireflyCruda {
  type?: string;
  date?: string;
  amount?: string;
  description?: string;
  currency_code?: string;
  currency_symbol?: string;
}

interface DatosTransaccion {
  monto: string;
  descripcion?: string;
  fecha?: string;
  moneda?: string;
}

function extraerPrimeraTransaccion(contenidoTool: string): TransaccionFireflyCruda | undefined {
  try {
    const parseado = JSON.parse(contenidoTool) as {
      data?: { attributes?: { transactions?: TransaccionFireflyCruda[] } };
    };
    return parseado.data?.attributes?.transactions?.[0];
  } catch {
    return undefined;
  }
}

function formatearMonto(monto: string, moneda?: string): string {
  const numero = Number(monto);
  const montoLegible = Number.isFinite(numero)
    ? numero.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : monto;
  return moneda ? `${montoLegible} ${moneda}` : `$${montoLegible}`;
}

function formatearFecha(fechaIso: string): string | undefined {
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(fecha);
}

const MENSAJE_CONFIRMACION_GENERICO = "✅ Gasto registrado.";

/**
 * AC #4 (historia 5.2): a partir del resultado crudo (JSON de Firefly III,
 * tal como lo devuelve `mcpToolExecutor.ejecutarTool`) de un
 * `create_transaction` exitoso, arma una confirmación en lenguaje natural
 * (monto, concepto, fecha) -- nunca el JSON crudo. Si el contenido no tiene
 * la forma esperada (parseo falla, faltan campos), cae a un mensaje genérico
 * en vez de lanzar o de mostrar algo ilegible (mismo criterio fail-safe que
 * el resto del proyecto).
 *
 * Standalone y probado, todavía sin invocar desde `messageOrchestrator.ts`
 * (fuera del Owned File/Module Scope de esta historia, que pertenece a
 * 5.4/5.1) -- Gemini sigue componiendo la respuesta final a partir del
 * `functionResponse` como en 5.1; este formateador queda disponible para
 * cuando una historia futura decida usarlo como confirmación determinística
 * en vez de (o además de) la respuesta de Gemini.
 */
export function formatearConfirmacionGasto(contenidoTool: string): string {
  const transaccion = extraerPrimeraTransaccion(contenidoTool);
  if (!transaccion || !transaccion.amount) {
    return MENSAJE_CONFIRMACION_GENERICO;
  }

  const datos: DatosTransaccion = {
    monto: transaccion.amount,
    descripcion: transaccion.description,
    fecha: transaccion.date,
    moneda: transaccion.currency_code,
  };

  const montoTexto = formatearMonto(datos.monto, datos.moneda);
  const fechaTexto = datos.fecha ? formatearFecha(datos.fecha) : undefined;

  const partes = [`✅ Registré un gasto de ${montoTexto}`];
  if (datos.descripcion) {
    partes.push(`en ${datos.descripcion}`);
  }
  if (fechaTexto) {
    partes.push(`(${fechaTexto})`);
  }

  return `${partes.join(" ")}.`;
}
