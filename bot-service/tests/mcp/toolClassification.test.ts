import { describe, expect, it } from "vitest";
import { clasificarToolCall } from "../../src/mcp/toolClassification.js";

describe("clasificarToolCall", () => {
  it("clasifica una tool de lectura como reversible (AC #1)", () => {
    expect(clasificarToolCall("get_accounts")).toBe("reversible");
    expect(clasificarToolCall("search_transactions")).toBe("reversible");
    expect(clasificarToolCall("export_transactions")).toBe("reversible");
  });

  it("clasifica una tool de creación/edición normal como reversible (AC #1)", () => {
    expect(clasificarToolCall("create_transaction")).toBe("reversible");
    expect(clasificarToolCall("update_account")).toBe("reversible");
    expect(clasificarToolCall("upload_attachment")).toBe("reversible");
  });

  it("clasifica cualquier tool delete_* como irreversible (AC #1)", () => {
    expect(clasificarToolCall("delete_transaction")).toBe("irreversible");
    expect(clasificarToolCall("delete_account")).toBe("irreversible");
    expect(clasificarToolCall("delete_rule_group")).toBe("irreversible");
  });

  it("clasifica trigger_rule/trigger_rule_group/trigger_recurrence como irreversibles (edge case documentado)", () => {
    expect(clasificarToolCall("trigger_rule")).toBe("irreversible");
    expect(clasificarToolCall("trigger_rule_group")).toBe("irreversible");
    expect(clasificarToolCall("trigger_recurrence")).toBe("irreversible");
  });

  it("update_transaction es reversible si no toca el campo reconciled", () => {
    expect(clasificarToolCall("update_transaction", { description: "nuevo texto" })).toBe("reversible");
  });

  it("update_transaction es irreversible si marca reconciled: true (caso reconciliación, AC #1)", () => {
    expect(clasificarToolCall("update_transaction", { reconciled: true })).toBe("irreversible");
  });

  it("update_transaction con reconciled: false sigue siendo reversible", () => {
    expect(clasificarToolCall("update_transaction", { reconciled: false })).toBe("reversible");
  });

  it("bulk_update_transactions es irreversible si CUALQUIER transacción del lote marca reconciled: true", () => {
    expect(
      clasificarToolCall("bulk_update_transactions", {
        transactions: [{ id: "1", description: "x" }, { id: "2", reconciled: true }],
      }),
    ).toBe("irreversible");
  });

  it("bulk_update_transactions es reversible si ninguna transacción del lote marca reconciled: true", () => {
    expect(
      clasificarToolCall("bulk_update_transactions", {
        transactions: [{ id: "1", description: "x" }],
      }),
    ).toBe("reversible");
  });

  it("una tool desconocida (no está en el catálogo de 4.2) es irreversible por default (fail-safe)", () => {
    expect(clasificarToolCall("tool_que_no_existe_todavia")).toBe("irreversible");
  });

  it("no requiere el argumento args para tools cuya clasificación no depende de argumentos", () => {
    expect(clasificarToolCall("get_accounts")).toBe("reversible");
    expect(clasificarToolCall("delete_transaction")).toBe("irreversible");
  });
});
