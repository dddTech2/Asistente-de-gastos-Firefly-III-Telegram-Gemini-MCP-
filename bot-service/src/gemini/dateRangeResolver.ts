/**
 * AC #2 (historia 5.3): traduce una expresión de tiempo relativa en español a
 * un rango de fechas concreto (`desde`/`hasta`, `YYYY-MM-DD`) dada la fecha
 * actual. Es el algoritmo de referencia, verificado con tests, que el
 * fragmento de prompt de consulta (`consultaGasto.prompt.ts`) documenta en
 * prosa para que Gemini pueda reproducirlo -- este módulo no está enganchado
 * en `messageOrchestrator.ts` (fuera del Owned File/Module Scope de esta
 * historia, mismo patrón "módulo standalone + tested" ya usado en 4.3 y 5.2):
 * hoy la resolución real de fechas ocurre en el razonamiento de Gemini a
 * partir del prompt, no acá. Queda documentado como candidato para una
 * historia futura que quiera hacer la resolución de fechas determinística en
 * vez de delegarla al LLM.
 *
 * Todos los cálculos usan componentes UTC (`getUTCDay`/`setUTCDate`/etc.) para
 * no depender de la zona horaria de la máquina donde corre el proceso --
 * mismo criterio de timezone-safety aplicado en `responseFormatter.ts` (5.2).
 */
export interface RangoFechas {
  desde: string;
  hasta: string;
}

function formatearFechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function sumarDias(fecha: Date, dias: number): Date {
  const copia = new Date(fecha);
  copia.setUTCDate(copia.getUTCDate() + dias);
  return copia;
}

/** Lunes (00:00 UTC) de la semana que contiene `fecha`, con `getUTCDay()`: 0=domingo..6=sábado. */
function inicioDeSemana(fecha: Date): Date {
  const diasDesdeElLunes = (fecha.getUTCDay() + 6) % 7;
  return sumarDias(fecha, -diasDesdeElLunes);
}

/**
 * Expresiones reconocidas explícitamente por el Testing (LOCKED) de esta
 * historia: "hoy", "la semana pasada", "este mes", "este año". Se agregan
 * "ayer" y "esta semana" por completitud del mismo patrón (mencionadas en el
 * prompt como ejemplos adicionales), sin ampliar el alcance de la historia.
 * Cualquier expresión no reconocida devuelve `undefined` -- el caso
 * "ambiguo/no reconocido" del Testing, cuyo comportamiento por defecto (mes
 * actual) se documenta y aplica en el fragmento de prompt, no acá.
 */
export function resolverRangoFechas(expresion: string, ahora: Date): RangoFechas | undefined {
  const normalizada = expresion.trim().toLowerCase();
  const hoyIso = formatearFechaIso(ahora);

  switch (normalizada) {
    case "hoy":
      return { desde: hoyIso, hasta: hoyIso };

    case "ayer": {
      const ayerIso = formatearFechaIso(sumarDias(ahora, -1));
      return { desde: ayerIso, hasta: ayerIso };
    }

    case "esta semana":
      return { desde: formatearFechaIso(inicioDeSemana(ahora)), hasta: hoyIso };

    case "la semana pasada": {
      const lunesActual = inicioDeSemana(ahora);
      const lunesPasado = sumarDias(lunesActual, -7);
      const domingoPasado = sumarDias(lunesActual, -1);
      return { desde: formatearFechaIso(lunesPasado), hasta: formatearFechaIso(domingoPasado) };
    }

    case "este mes": {
      const primerDia = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, "0")}-01`;
      return { desde: primerDia, hasta: hoyIso };
    }

    case "este año": {
      const primerDia = `${ahora.getUTCFullYear()}-01-01`;
      return { desde: primerDia, hasta: hoyIso };
    }

    default:
      return undefined;
  }
}
