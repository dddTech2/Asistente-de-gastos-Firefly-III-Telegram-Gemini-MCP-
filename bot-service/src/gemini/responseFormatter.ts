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
const MENSAJE_SIN_RESULTADOS = "No encontré gastos registrados para esa consulta.";

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

/** Firefly agrupa transacciones en `data[].attributes.transactions[]` (misma forma confirmada en 4.2 para `create_transaction`) tanto en `get_transactions` como en `get_category_transactions`. */
function extraerTransacciones(contenidoTool: string): TransaccionFireflyCruda[] {
  try {
    const parseado = JSON.parse(contenidoTool) as {
      data?: Array<{ attributes?: { transactions?: TransaccionFireflyCruda[] } }>;
    };
    return (parseado.data ?? []).flatMap((grupo) => grupo.attributes?.transactions ?? []);
  } catch {
    return [];
  }
}

/**
 * AC #3, #4 (historia 5.3): a partir del resultado crudo de una tool de
 * consulta (`get_transactions`/`get_category_transactions`), suma los montos
 * por moneda y arma un resumen en lenguaje natural -- nunca el JSON crudo. Si
 * no hay transacciones (o ninguna tiene un monto numérico válido), devuelve
 * un mensaje claro de "no hay gasto registrado" (AC #4), nunca un error.
 *
 * Standalone y probado, todavía sin invocar desde `messageOrchestrator.ts`
 * (mismo gap documentado que `formatearConfirmacionGasto` en 5.2): hoy Gemini
 * compone la respuesta final a partir del `functionResponse` crudo, este
 * formateador queda disponible para cuando una historia futura quiera una
 * respuesta determinística en vez de (o además de) la de Gemini.
 */
export function formatearResumenConsulta(contenidoTool: string): string {
  const transacciones = extraerTransacciones(contenidoTool);

  const totalesPorMoneda = new Map<string, number>();
  for (const transaccion of transacciones) {
    const monto = Number(transaccion.amount);
    if (!Number.isFinite(monto)) {
      continue;
    }
    const moneda = transaccion.currency_code ?? "";
    totalesPorMoneda.set(moneda, (totalesPorMoneda.get(moneda) ?? 0) + monto);
  }

  if (totalesPorMoneda.size === 0) {
    return MENSAJE_SIN_RESULTADOS;
  }

  const partes = [...totalesPorMoneda.entries()].map(([moneda, total]) =>
    formatearMonto(String(total), moneda || undefined),
  );

  return `💰 Gastaste ${partes.join(" + ")} en el período consultado.`;
}
