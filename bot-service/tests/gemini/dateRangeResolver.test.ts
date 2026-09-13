import { describe, expect, it } from "vitest";
import { resolverRangoFechas } from "../../src/gemini/dateRangeResolver.js";

/**
 * Domingo 13/09/2026 (fecha de referencia fija, consistente con el resto de
 * la suite de la historia 5.x). Elegida deliberadamente como domingo para que
 * "esta semana"/"la semana pasada" ejerciten el cálculo de lunes-a-domingo en
 * el borde de la semana calendario, no en el medio.
 */
const FECHA_FIJA = new Date("2026-09-13T12:00:00.000Z");

describe("resolverRangoFechas (AC #2 — historia 5.3)", () => {
  it("'hoy' resuelve a la fecha actual en ambos extremos", () => {
    expect(resolverRangoFechas("hoy", FECHA_FIJA)).toEqual({ desde: "2026-09-13", hasta: "2026-09-13" });
  });

  it("'ayer' resuelve a la fecha actual menos un día", () => {
    expect(resolverRangoFechas("ayer", FECHA_FIJA)).toEqual({ desde: "2026-09-12", hasta: "2026-09-12" });
  });

  it("'esta semana' resuelve desde el lunes de la semana actual hasta hoy", () => {
    expect(resolverRangoFechas("esta semana", FECHA_FIJA)).toEqual({ desde: "2026-09-07", hasta: "2026-09-13" });
  });

  it("'la semana pasada' resuelve lunes-a-domingo de la semana calendario anterior, no los últimos 7 días corridos", () => {
    expect(resolverRangoFechas("la semana pasada", FECHA_FIJA)).toEqual({
      desde: "2026-08-31",
      hasta: "2026-09-06",
    });
  });

  it("'este mes' resuelve desde el día 1 del mes actual hasta hoy", () => {
    expect(resolverRangoFechas("este mes", FECHA_FIJA)).toEqual({ desde: "2026-09-01", hasta: "2026-09-13" });
  });

  it("'este año' resuelve desde el 1 de enero del año actual hasta hoy", () => {
    expect(resolverRangoFechas("este año", FECHA_FIJA)).toEqual({ desde: "2026-01-01", hasta: "2026-09-13" });
  });

  it("es insensible a mayúsculas y a espacios extra", () => {
    expect(resolverRangoFechas("  ESTE MES  ", FECHA_FIJA)).toEqual({ desde: "2026-09-01", hasta: "2026-09-13" });
  });

  it("una expresión ambigua o no reconocida devuelve undefined (el default a 'este mes' es responsabilidad del prompt, no de este módulo)", () => {
    expect(resolverRangoFechas("el otro día", FECHA_FIJA)).toBeUndefined();
    expect(resolverRangoFechas("", FECHA_FIJA)).toBeUndefined();
  });
});
