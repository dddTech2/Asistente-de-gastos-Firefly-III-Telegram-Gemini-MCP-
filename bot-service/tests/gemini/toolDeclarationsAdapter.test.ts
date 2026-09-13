import { describe, expect, it } from "vitest";
import { adaptarToolsDeMcpAGemini, type McpToolSchema } from "../../src/gemini/toolDeclarationsAdapter.js";

const TOOL_CREATE_TRANSACTION: McpToolSchema = {
  name: "create_transaction",
  description: "Crea una transacción en Firefly III",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "string" },
      description: { type: "string" },
    },
    required: ["amount", "description"],
  },
};

describe("adaptarToolsDeMcpAGemini", () => {
  it("traduce nombre, descripción y JSON Schema 1:1 a functionDeclaration (AC #2)", () => {
    const resultado = adaptarToolsDeMcpAGemini([TOOL_CREATE_TRANSACTION]);

    expect(resultado).toEqual([
      {
        name: "create_transaction",
        description: "Crea una transacción en Firefly III",
        parametersJsonSchema: TOOL_CREATE_TRANSACTION.inputSchema,
      },
    ]);
  });

  it("una tool sin description cae a string vacío, nunca undefined", () => {
    const [resultado] = adaptarToolsDeMcpAGemini([{ name: "get_accounts", inputSchema: { type: "object" } }]);
    expect(resultado!.description).toBe("");
  });

  it("una tool sin inputSchema cae a un esquema de objeto sin propiedades", () => {
    const [resultado] = adaptarToolsDeMcpAGemini([{ name: "trigger_recurrence" }]);
    expect(resultado!.parametersJsonSchema).toEqual({ type: "object", properties: {} });
  });

  it("un catálogo vacío produce un array vacío", () => {
    expect(adaptarToolsDeMcpAGemini([])).toEqual([]);
  });

  it("traduce varias tools preservando el orden", () => {
    const resultado = adaptarToolsDeMcpAGemini([
      { name: "get_accounts", description: "Lista cuentas" },
      TOOL_CREATE_TRANSACTION,
    ]);
    expect(resultado.map((t) => t.name)).toEqual(["get_accounts", "create_transaction"]);
  });
});
