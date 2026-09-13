import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn().mockResolvedValue(undefined);
const closeMock = vi.fn().mockResolvedValue(undefined);
const listToolsMock = vi.fn();
const callToolMock = vi.fn();
const transportConstructorSpy = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: connectMock,
    close: closeMock,
    listTools: listToolsMock,
    callTool: callToolMock,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL, opts: unknown) => {
    transportConstructorSpy(url, opts);
    return { url, opts };
  }),
}));

const { createMcpToolExecutor } = await import("../../src/mcp/mcpToolExecutor.js");

const MCP_URL = "http://127.0.0.1:3100/mcp";
const PAT_A = "pat-usuario-a";

describe("mcpToolExecutor", () => {
  beforeEach(() => {
    connectMock.mockClear();
    closeMock.mockClear();
    listToolsMock.mockReset();
    callToolMock.mockReset();
    transportConstructorSpy.mockClear();
  });

  it("listarTools abre la conexión con Authorization: Bearer <PAT> y la cierra al terminar", async () => {
    listToolsMock.mockResolvedValue({
      tools: [{ name: "get_accounts", description: "Lista cuentas", inputSchema: { type: "object" } }],
    });

    const executor = createMcpToolExecutor(MCP_URL);
    const tools = await executor.listarTools(PAT_A);

    expect(transportConstructorSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = transportConstructorSpy.mock.calls[0]!;
    expect((url as URL).toString()).toBe(MCP_URL);
    expect((opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers.Authorization).toBe(
      `Bearer ${PAT_A}`,
    );

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(tools).toEqual([{ name: "get_accounts", description: "Lista cuentas", inputSchema: { type: "object" } }]);
  });

  it("cada llamada usa el PAT que le pasan, nunca uno guardado de una llamada anterior (aislamiento, AC #5 de 4.1/4.2)", async () => {
    listToolsMock.mockResolvedValue({ tools: [] });
    const executor = createMcpToolExecutor(MCP_URL);

    await executor.listarTools("pat-A");
    await executor.listarTools("pat-B");

    const headerLlamada1 = (transportConstructorSpy.mock.calls[0]![1] as { requestInit: { headers: Record<string, string> } })
      .requestInit.headers.Authorization;
    const headerLlamada2 = (transportConstructorSpy.mock.calls[1]![1] as { requestInit: { headers: Record<string, string> } })
      .requestInit.headers.Authorization;

    expect(headerLlamada1).toBe("Bearer pat-A");
    expect(headerLlamada2).toBe("Bearer pat-B");
  });

  it("ejecutarTool invoca callTool con name/arguments y concatena los bloques de texto del resultado", async () => {
    callToolMock.mockResolvedValue({
      content: [
        { type: "text", text: "cuenta creada" },
        { type: "text", text: "id: 4" },
      ],
      isError: false,
    });

    const executor = createMcpToolExecutor(MCP_URL);
    const resultado = await executor.ejecutarTool(PAT_A, "create_transaction", { amount: "5000" });

    expect(callToolMock).toHaveBeenCalledWith({ name: "create_transaction", arguments: { amount: "5000" } });
    expect(resultado).toEqual({ contenido: "cuenta creada\nid: 4", esError: false });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("un tool_not_found u otro error de protocolo vuelve como esError:true sin lanzar (AC de manejo de errores, 4.2)", async () => {
    callToolMock.mockResolvedValue({
      content: [{ type: "text", text: "tool_not_found: no existe la tool solicitada" }],
      isError: true,
    });

    const executor = createMcpToolExecutor(MCP_URL);
    const resultado = await executor.ejecutarTool(PAT_A, "tool_que_no_existe", {});

    expect(resultado.esError).toBe(true);
    expect(resultado.contenido).toContain("tool_not_found");
  });

  it("un resultado sin bloques de texto devuelve contenido vacío en vez de romper", async () => {
    callToolMock.mockResolvedValue({ content: [], isError: false });
    const executor = createMcpToolExecutor(MCP_URL);

    const resultado = await executor.ejecutarTool(PAT_A, "get_accounts", {});
    expect(resultado).toEqual({ contenido: "", esError: false });
  });

  it("un error de transporte inesperado se propaga sin capturar (edge case explícito del Testing de 5.1)", async () => {
    callToolMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const executor = createMcpToolExecutor(MCP_URL);

    await expect(executor.ejecutarTool(PAT_A, "get_accounts", {})).rejects.toThrow("ECONNREFUSED");
  });
});
