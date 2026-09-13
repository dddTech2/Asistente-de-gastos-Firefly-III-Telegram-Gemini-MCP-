import { vi } from "vitest";
import type { FireflyClient } from "../../src/services/firefly-client.js";

/**
 * Para tests de otras historias (2.1/2.2/2.3/8.1) que ejercitan el pipeline
 * del webhook pero no la lógica de `/gasto` en sí (que tiene su propia suite
 * en tests/commands/gasto.test.ts) -- nunca debería ser invocado en esas
 * suites, ya que ninguna envía un update `/gasto`.
 */
export function createNeverCalledFireflyClient(): FireflyClient {
  return {
    crearTransaccion: vi.fn().mockRejectedValue(new Error("no debería llamarse en este test")),
  };
}
