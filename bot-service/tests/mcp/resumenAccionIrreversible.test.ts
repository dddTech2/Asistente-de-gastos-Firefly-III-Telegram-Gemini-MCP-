import { describe, expect, it } from "vitest";
import { resumirAccionIrreversible } from "../../src/mcp/resumenAccionIrreversible.js";

describe("resumirAccionIrreversible (AC #1 — historia 5.14)", () => {
  it("arma un resumen legible con el nombre de la tool y sus argumentos", () => {
    const resumen = resumirAccionIrreversible("delete_transaction", { id: "42" });
    expect(resumen).toBe("delete transaction (id: 42)");
  });

  it("junta varios argumentos separados por coma", () => {
    const resumen = resumirAccionIrreversible("update_transaction", { id: "7", reconciled: true });
    expect(resumen).toContain("id: 7");
    expect(resumen).toContain("reconciled: true");
  });

  it("sin argumentos, devuelve solo el nombre de la acción", () => {
    expect(resumirAccionIrreversible("trigger_recurrence", {})).toBe("trigger recurrence");
  });

  it("nunca contiene JSON crudo (llaves/corchetes) para argumentos escalares", () => {
    const resumen = resumirAccionIrreversible("delete_account", { id: "3", name: "Efectivo" });
    expect(resumen).not.toMatch(/[{}[\]]/);
  });
});
