import { vi } from "vitest";
import type { UsuariosRepository } from "../../src/db/usuarios.repository.js";

/**
 * Autoriza cualquier chat_id — para tests de otras historias (2.1/2.2/2.3/8.1)
 * que ejercitan el pipeline del webhook pero no la lógica de whitelist en sí
 * (que tiene su propia suite en tests/auth/whitelistMiddleware.test.ts).
 */
export function createAllowAllRepository(): UsuariosRepository {
  return {
    findByChatId: vi.fn().mockImplementation(async (chatId: number) => ({ chatId, activo: true })),
    crear: vi.fn().mockResolvedValue(undefined),
    guardarPatCifrado: vi.fn().mockResolvedValue(undefined),
    obtenerPatDescifrado: vi.fn().mockResolvedValue(null),
  };
}
