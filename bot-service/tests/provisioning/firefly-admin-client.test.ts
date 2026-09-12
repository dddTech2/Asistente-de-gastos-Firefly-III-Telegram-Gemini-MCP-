import { afterEach, describe, expect, it, vi } from "vitest";
import { createFireflyAdminClient, FireflyAdminClientError } from "../../src/provisioning/firefly-admin-client.js";

function mockFetchOnce(response: { ok: boolean; status?: number; json?: unknown; text?: string }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.json,
      text: async () => response.text ?? "",
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFireflyAdminClient.crearUsuario", () => {
  it("hace POST a /api/v1/users con el token owner y devuelve id + email (AC #1)", async () => {
    mockFetchOnce({
      ok: true,
      json: { data: { id: "42", attributes: { email: "nuevo@ejemplo.com" } } },
    });

    const client = createFireflyAdminClient({
      baseUrl: "https://firefly.ejemplo.com",
      ownerToken: "owner-token-de-prueba",
    });

    const resultado = await client.crearUsuario({ email: "nuevo@ejemplo.com" });

    expect(resultado).toEqual({ id: "42", email: "nuevo@ejemplo.com" });
    expect(fetch).toHaveBeenCalledWith(
      "https://firefly.ejemplo.com/api/v1/users",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer owner-token-de-prueba" }),
        body: JSON.stringify({ email: "nuevo@ejemplo.com" }),
      }),
    );
  });

  it("no envia ningun campo 'role' en el body (el usuario nuevo no debe heredar el rol owner)", async () => {
    mockFetchOnce({ ok: true, json: { data: { id: "1", attributes: { email: "a@b.com" } } } });

    const client = createFireflyAdminClient({ baseUrl: "https://firefly.ejemplo.com", ownerToken: "t" });
    await client.crearUsuario({ email: "a@b.com" });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("role");
  });

  it("lanza FireflyAdminClientError si la respuesta no es ok", async () => {
    mockFetchOnce({ ok: false, status: 422, text: '{"message":"email ya existe"}' });

    const client = createFireflyAdminClient({ baseUrl: "https://firefly.ejemplo.com", ownerToken: "t" });

    await expect(client.crearUsuario({ email: "duplicado@ejemplo.com" })).rejects.toThrow(
      FireflyAdminClientError,
    );
  });

  it("propaga el status HTTP en el error para que el orquestador pueda distinguir causas", async () => {
    mockFetchOnce({ ok: false, status: 500, text: "" });

    const client = createFireflyAdminClient({ baseUrl: "https://firefly.ejemplo.com", ownerToken: "t" });

    await expect(client.crearUsuario({ email: "a@b.com" })).rejects.toMatchObject({ status: 500 });
  });
});
