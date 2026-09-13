import { describe, expect, it, vi } from "vitest";
import { createCredentialResolver, type CredentialResolverDeps } from "../../src/auth/credential-resolver.js";

/**
 * PAT dummy que incluye el propio chat_id -- si dos resoluciones concurrentes
 * se cruzaran (AC #3, #5), el PAT devuelto para un chat_id contendría el
 * chat_id de otro y el assert de igualdad fallaría de forma obvia.
 */
function patDummyPara(chatId: number): string {
  return `pat-dummy-${chatId}`;
}

/**
 * Simula latencia variable e intercalada por chat_id (distinto orden de
 * finalización que de inicio) para no depender de que Promise.all resuelva
 * en el mismo orden en que fue invocado.
 */
function buildDepsConLatenciaVariable(): CredentialResolverDeps {
  return {
    usuariosRepository: {
      obtenerPatDescifrado: vi.fn().mockImplementation(async (chatId: number) => {
        const demoraMs = (chatId % 5) * 3;
        await new Promise((resolve) => setTimeout(resolve, demoraMs));
        return patDummyPara(chatId);
      }),
    },
    fireflyUrl: "https://firefly.ejemplo.com",
  };
}

describe("createCredentialResolver — concurrencia (AC #3, #5)", () => {
  it("dos chat_id distintos resueltos concurrentemente obtienen credenciales correctas, sin cruzarse (AC #5)", async () => {
    const resolver = createCredentialResolver(buildDepsConLatenciaVariable());

    const [credencialesA, credencialesB] = await Promise.all([
      resolver.getUserCredentials(111),
      resolver.getUserCredentials(222),
    ]);

    expect(credencialesA.pat).toBe(patDummyPara(111));
    expect(credencialesB.pat).toBe(patDummyPara(222));
  });

  it("tres o más chat_id intercalados devuelven siempre la credencial correspondiente a su propio chat_id (AC #5)", async () => {
    const resolver = createCredentialResolver(buildDepsConLatenciaVariable());
    const chatIds = [301, 302, 303, 304, 305];

    const resultados = await Promise.all(chatIds.map((chatId) => resolver.getUserCredentials(chatId)));

    resultados.forEach((credenciales, i) => {
      expect(credenciales.pat).toBe(patDummyPara(chatIds[i]));
    });
  });

  it("alta concurrencia sintética (20 chat_id simultáneos) no produce ningún cruce de credenciales (edge case)", async () => {
    const resolver = createCredentialResolver(buildDepsConLatenciaVariable());
    const chatIds = Array.from({ length: 20 }, (_, i) => 1000 + i);

    const resultados = await Promise.all(chatIds.map((chatId) => resolver.getUserCredentials(chatId)));

    const pats = resultados.map((c) => c.pat);
    expect(new Set(pats).size).toBe(chatIds.length); // todos distintos entre sí
    chatIds.forEach((chatId, i) => {
      expect(pats[i]).toBe(patDummyPara(chatId));
    });
  });

  it("no existe estado de módulo que sobreviva entre invocaciones: la salida depende solo del input (AC #3)", async () => {
    const resolver = createCredentialResolver(buildDepsConLatenciaVariable());

    const primera = await resolver.getUserCredentials(42);
    const segunda = await resolver.getUserCredentials(43);
    const terceraRepiteLaPrimera = await resolver.getUserCredentials(42);

    expect(primera.pat).toBe(patDummyPara(42));
    expect(segunda.pat).toBe(patDummyPara(43));
    expect(terceraRepiteLaPrimera).toEqual(primera); // resolver de nuevo el mismo chat_id da el mismo resultado, no el de la llamada intermedia
  });

  it("crear dos resolvers distintos con configuración distinta no comparte estado entre sí", async () => {
    const resolverA = createCredentialResolver({
      usuariosRepository: { obtenerPatDescifrado: vi.fn().mockResolvedValue("pat-instancia-A") },
      fireflyUrl: "https://firefly-a.ejemplo.com",
    });
    const resolverB = createCredentialResolver({
      usuariosRepository: { obtenerPatDescifrado: vi.fn().mockResolvedValue("pat-instancia-B") },
      fireflyUrl: "https://firefly-b.ejemplo.com",
    });

    const [credencialesA, credencialesB] = await Promise.all([
      resolverA.getUserCredentials(1),
      resolverB.getUserCredentials(1),
    ]);

    expect(credencialesA).toEqual({ pat: "pat-instancia-A", fireflyUrl: "https://firefly-a.ejemplo.com" });
    expect(credencialesB).toEqual({ pat: "pat-instancia-B", fireflyUrl: "https://firefly-b.ejemplo.com" });
  });
});
