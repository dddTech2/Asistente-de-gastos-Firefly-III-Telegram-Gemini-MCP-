import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpToolSchema } from "../gemini/toolDeclarationsAdapter.js";

export interface ResultadoTool {
  contenido: string;
  esError: boolean;
}

export interface McpToolExecutor {
  listarTools(pat: string): Promise<McpToolSchema[]>;
  ejecutarTool(pat: string, nombreTool: string, argumentos: Record<string, unknown>): Promise<ResultadoTool>;
}

const NOMBRE_CLIENTE_MCP = "asistente-gastos-bot";
const VERSION_CLIENTE_MCP = "1.0.0";

/**
 * Una conexión nueva por llamada, nunca reutilizada entre requests: mismo
 * criterio "sin estado compartido entre invocaciones" que
 * `credential-resolver.ts` (historia 1.5) -- el PAT viaja únicamente en el
 * header `Authorization` de esta conexión puntual, jamás en una variable de
 * módulo. [Source: mcp/README.md#contrato-de-headers]
 */
async function conectarCliente(mcpUrl: string, pat: string): Promise<{ client: Client; cerrar: () => Promise<void> }> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${pat}` } },
  });
  const client = new Client({ name: NOMBRE_CLIENTE_MCP, version: VERSION_CLIENTE_MCP });
  await client.connect(transport);
  return { client, cerrar: () => client.close() };
}

/**
 * AC #3 (historia 5.1): ejecuta la tool solicitada por Gemini contra el MCP
 * de Firefly III vía `@modelcontextprotocol/sdk`, propagando el PAT propio
 * del usuario (nunca uno compartido). Un `tool_not_found` u otro error a
 * nivel de protocolo MCP vuelve como `esError: true` con el mensaje del
 * servidor -- comportamiento ya verificado empíricamente en la historia 4.2
 * ("una tool inexistente devuelve un error JSON-RPC legible sin crashear el
 * servidor"). Un error de transporte/conexión inesperado, en cambio, se deja
 * propagar sin capturar: la clasificación fina de errores es de la historia
 * 5.4. [Source: bmad-output/stories/5.1.prompt-tools-gemini.story.md#testing]
 */
export function createMcpToolExecutor(mcpUrl: string): McpToolExecutor {
  return {
    async listarTools(pat) {
      const { client, cerrar } = await conectarCliente(mcpUrl, pat);
      try {
        const { tools } = await client.listTools();
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
      } finally {
        await cerrar();
      }
    },

    async ejecutarTool(pat, nombreTool, argumentos) {
      const { client, cerrar } = await conectarCliente(mcpUrl, pat);
      try {
        const resultado = await client.callTool({ name: nombreTool, arguments: argumentos });
        const bloquesContenido = Array.isArray(resultado.content) ? resultado.content : [];
        const contenido = bloquesContenido
          .filter((bloque): bloque is { type: "text"; text: string } => bloque.type === "text")
          .map((bloque) => bloque.text)
          .join("\n");

        return { contenido, esError: Boolean(resultado.isError) };
      } finally {
        await cerrar();
      }
    },
  };
}
