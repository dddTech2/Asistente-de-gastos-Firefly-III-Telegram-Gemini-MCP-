import type { FunctionDeclaration } from "@google/genai";

/** Forma mínima de una tool tal como la devuelve `tools/list` del MCP (JSON Schema en `inputSchema`). */
export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const ESQUEMA_SIN_PARAMETROS = { type: "object", properties: {} };

/**
 * AC #2 (historia 5.1): traduce el catálogo de tools del MCP (JSON Schema) al
 * formato `functionDeclarations` de Gemini, sin ninguna definición hardcodeada
 * por fuera de esta traducción. `parametersJsonSchema` acepta JSON Schema
 * directo -- no hace falta reescribirlo al formato `Schema`/`Type` propio de
 * `@google/genai` [verificado contra `FunctionDeclaration` de `@google/genai`
 * 2.22.0: "parametersJsonSchema... mutually exclusive with `parameters`"].
 */
export function adaptarToolsDeMcpAGemini(toolsMcp: McpToolSchema[]): FunctionDeclaration[] {
  return toolsMcp.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    parametersJsonSchema: tool.inputSchema ?? ESQUEMA_SIN_PARAMETROS,
  }));
}
