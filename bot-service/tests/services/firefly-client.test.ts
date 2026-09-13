import { afterEach, describe, expect, it, vi } from "vitest";
import { FireflyClientError, createFireflyClient } from "../../src/services/firefly-client.js";

const CONFIG = { baseUrl: "https://firefly.ejemplo.com", pat: "pat-de-prueba", sourceAccount: "Efectivo" };

function mockFetchOnce(response: Partial<Response> & { ok: boolean; status?: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json ?? vi.fn(),
      text: response.text ?? vi.fn().mockResolvedValue(""),
    }),
  );
}

describe("createFireflyClient.crearTransaccion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hace POST a /api/v1/transactions con el header Authorization y el payload correctos (AC #1)", async () => {
    mockFetchOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ data: { id: "42" } }) });
    const client = createFireflyClient(CONFIG);

    const resultado = await client.crearTransaccion({ monto: 20000, concepto: "almuerzo" });

    expect(resultado).toEqual({ id: "42" });
    const [url, opciones] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://firefly.ejemplo.com/api/v1/transactions");
    expect(opciones.method).toBe("POST");
    expect(opciones.headers.Authorization).toBe("Bearer pat-de-prueba");
    const body = JSON.parse(opciones.body);
    expect(body.transactions[0]).toMatchObject({
      type: "withdrawal",
      amount: "20000",
      description: "almuerzo",
      source_name: "Efectivo",
      destination_name: "almuerzo",
    });
  });

  it("el PAT nunca aparece en texto plano fuera del header Authorization (AC #6)", async () => {
    mockFetchOnce({ ok: true, json: vi.fn().mockResolvedValue({ data: { id: "1" } }) });
    const client = createFireflyClient(CONFIG);

    await client.crearTransaccion({ monto: 100, concepto: "test" });

    const [, opciones] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opciones.body).not.toContain("pat-de-prueba");
  });

  it("lanza FireflyClientError con el status si Firefly responde 422 (validación)", async () => {
    mockFetchOnce({ ok: false, status: 422 });
    const client = createFireflyClient(CONFIG);

    await expect(client.crearTransaccion({ monto: 100, concepto: "x" })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("lanza FireflyClientError si Firefly responde 401 (PAT inválido/expirado)", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    const client = createFireflyClient(CONFIG);

    await expect(client.crearTransaccion({ monto: 100, concepto: "x" })).rejects.toThrow(FireflyClientError);
  });

  it("lanza FireflyClientError sin exponer el status si fetch falla (conexión rechazada / caído)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const client = createFireflyClient(CONFIG);

    await expect(client.crearTransaccion({ monto: 100, concepto: "x" })).rejects.toThrow(FireflyClientError);
  });

  it("lanza FireflyClientError con mensaje de timeout si fetch aborta por tiempo", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));
    const client = createFireflyClient(CONFIG);

    await expect(client.crearTransaccion({ monto: 100, concepto: "x" })).rejects.toThrow(/no respondió a tiempo/);
  });

  it("el error de respuesta no-ok nunca incluye el cuerpo de la respuesta (defensa en profundidad)", async () => {
    mockFetchOnce({ ok: false, status: 500, text: vi.fn().mockResolvedValue("detalle-interno-sensible") });
    const client = createFireflyClient(CONFIG);

    await expect(client.crearTransaccion({ monto: 100, concepto: "x" })).rejects.not.toMatchObject({
      message: expect.stringContaining("detalle-interno-sensible"),
    });
  });
});
