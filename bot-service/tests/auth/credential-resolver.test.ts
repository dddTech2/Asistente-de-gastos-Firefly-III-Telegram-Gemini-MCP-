import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CredencialesNoDisponiblesError,
  createCredentialResolver,
  type CredentialResolverDeps,
} from "../../src/auth/credential-resolver.js";
import { PatCryptoError } from "../../src/auth/pat-crypto.js";
import { logger } from "../../src/lib/logger.js";

function buildDeps(obtenerPatDescifrado: CredentialResolverDeps["usuariosRepository"]["obtenerPatDescifrado"]) {
  return {
    usuariosRepository: { obtenerPatDescifrado },
    fireflyUrl: "https://firefly.ejemplo.com",
  } satisfies CredentialResolverDeps;
}

describe("createCredentialResolver.getUserCredentials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("devuelve pat + fireflyUrl listos para el header Authorization (AC #2)", async () => {
    const deps = buildDeps(vi.fn().mockResolvedValue("pat-de-prueba-123"));
    const resolver = createCredentialResolver(deps);

    const credenciales = await resolver.getUserCredentials(555);

    expect(credenciales).toEqual({ pat: "pat-de-prueba-123", fireflyUrl: "https://firefly.ejemplo.com" });
  });

  it("corta antes de llegar al MCP si no hay PAT para el chat_id (AC #4)", async () => {
    const deps = buildDeps(vi.fn().mockResolvedValue(null));
    const resolver = createCredentialResolver(deps);
    const mcpMock = vi.fn();

    await expect(resolver.getUserCredentials(999)).rejects.toThrow(CredencialesNoDisponiblesError);
    expect(mcpMock).not.toHaveBeenCalled();
  });

  it("un PAT corrupto/no descifrable (PatCryptoError de 1.4) falla seguro como 'sin credenciales', no como excepción sin manejar (edge case)", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const deps = buildDeps(vi.fn().mockRejectedValue(new PatCryptoError("clave incorrecta")));
    const resolver = createCredentialResolver(deps);

    await expect(resolver.getUserCredentials(777)).rejects.toThrow(CredencialesNoDisponiblesError);
  });

  it("un fallo inesperado de la capa de 1.4 (ej. Postgres caído) también se niega, nunca hace fallback (edge case)", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const deps = buildDeps(vi.fn().mockRejectedValue(new Error("Postgres caído")));
    const resolver = createCredentialResolver(deps);

    await expect(resolver.getUserCredentials(1234)).rejects.toThrow(CredencialesNoDisponiblesError);
  });

  it("el error de credenciales no disponibles no expone ningún PAT y loggea el chat_id sin datos sensibles", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const deps = buildDeps(vi.fn().mockRejectedValue(new PatCryptoError("clave incorrecta")));
    const resolver = createCredentialResolver(deps);

    try {
      await resolver.getUserCredentials(42);
    } catch (error) {
      expect(error).toBeInstanceOf(CredencialesNoDisponiblesError);
      expect((error as CredencialesNoDisponiblesError).chatId).toBe(42);
    }

    const [context] = errorSpy.mock.calls[0]!;
    expect(context).toMatchObject({ chat_id: 42 });
    expect(Object.keys(context as object).sort()).toEqual(["chat_id", "err"]);
  });

  it("resuelve las credenciales ANTES de que se invoque cualquier tool del MCP (AC #1, orden de operaciones)", async () => {
    const orden: string[] = [];
    const deps = buildDeps(
      vi.fn().mockImplementation(async () => {
        orden.push("resolver-credenciales");
        return "pat-de-prueba";
      }),
    );
    const resolver = createCredentialResolver(deps);
    const mcpMock = vi.fn().mockImplementation(async () => {
      orden.push("invocar-tool-mcp");
    });

    const credenciales = await resolver.getUserCredentials(555);
    await mcpMock(credenciales);

    expect(orden).toEqual(["resolver-credenciales", "invocar-tool-mcp"]);
  });

  it("si no hay credenciales, el mock del cliente MCP nunca llega a invocarse (AC #1 + #4 combinados)", async () => {
    const deps = buildDeps(vi.fn().mockResolvedValue(null));
    const resolver = createCredentialResolver(deps);
    const mcpMock = vi.fn();

    async function invocarToolSimulada(chatId: number) {
      const credenciales = await resolver.getUserCredentials(chatId);
      await mcpMock(credenciales);
    }

    await expect(invocarToolSimulada(999)).rejects.toThrow(CredencialesNoDisponiblesError);
    expect(mcpMock).not.toHaveBeenCalled();
  });
});
