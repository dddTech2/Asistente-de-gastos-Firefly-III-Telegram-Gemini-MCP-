import { describe, expect, it } from "vitest";
import { formatearConfirmacionGasto } from "../../src/gemini/responseFormatter.js";

function resultadoFireflyExitoso(overrides: Partial<{
  amount: string;
  description: string;
  date: string;
  currency_code: string;
  type: string;
}> = {}): string {
  return JSON.stringify({
    data: {
      type: "transactions",
      id: "4",
      attributes: {
        transactions: [
          {
            type: "withdrawal",
            date: "2026-09-13T00:00:00+00:00",
            amount: "20000.00",
            description: "almuerzo",
            currency_code: "ARS",
            ...overrides,
          },
        ],
      },
    },
  });
}

describe("formatearConfirmacionGasto (AC #4)", () => {
  it("arma una confirmación en lenguaje natural con monto, concepto y fecha", () => {
    const mensaje = formatearConfirmacionGasto(resultadoFireflyExitoso());

    expect(mensaje).toContain("almuerzo");
    expect(mensaje).toContain("20.000");
    expect(mensaje).toContain("13/09/2026");
    expect(mensaje.startsWith("✅")).toBe(true);
  });

  it("nunca devuelve JSON crudo, incluso con datos completos", () => {
    const mensaje = formatearConfirmacionGasto(resultadoFireflyExitoso());
    expect(mensaje).not.toMatch(/[{}[\]]/);
  });

  it("sin descripción, omite la parte 'en ...' sin romper el mensaje", () => {
    const mensaje = formatearConfirmacionGasto(resultadoFireflyExitoso({ description: "" }));
    expect(mensaje).not.toContain("en almuerzo");
    expect(mensaje).toContain("20.000");
  });

  it("sin fecha, omite la parte de fecha sin romper el mensaje", () => {
    const mensaje = formatearConfirmacionGasto(resultadoFireflyExitoso({ date: "" }));
    expect(mensaje).not.toContain("13/09/2026");
    expect(mensaje).toContain("20.000");
  });

  it("un contenido que no es JSON cae al mensaje genérico, sin lanzar", () => {
    expect(() => formatearConfirmacionGasto("esto no es JSON")).not.toThrow();
    expect(formatearConfirmacionGasto("esto no es JSON")).toBe("✅ Gasto registrado.");
  });

  it("un JSON válido pero sin transacciones cae al mensaje genérico", () => {
    const mensaje = formatearConfirmacionGasto(JSON.stringify({ data: { attributes: { transactions: [] } } }));
    expect(mensaje).toBe("✅ Gasto registrado.");
  });

  it("un monto no numérico se muestra tal cual en vez de romper el formateo", () => {
    const mensaje = formatearConfirmacionGasto(resultadoFireflyExitoso({ amount: "n/a" }));
    expect(mensaje).toContain("n/a");
  });
});
