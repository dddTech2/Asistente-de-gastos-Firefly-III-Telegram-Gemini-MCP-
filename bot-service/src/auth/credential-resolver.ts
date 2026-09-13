import type { UsuariosRepository } from "../db/usuarios.repository.js";
import { logger } from "../lib/logger.js";

/**
 * Forma lista para ir en la llamada al MCP de Firefly III:
 * `Authorization: Bearer ${pat}` contra `fireflyUrl`.
 */
export interface CredencialesUsuario {
  pat: string;
  fireflyUrl: string;
}

export class CredencialesNoDisponiblesError extends Error {
  constructor(public readonly chatId: number) {
    super(`No hay credenciales disponibles para chat_id ${chatId}`);
    this.name = "CredencialesNoDisponiblesError";
  }
}

export interface CredentialResolverDeps {
  usuariosRepository: Pick<UsuariosRepository, "obtenerPatDescifrado">;
  fireflyUrl: string;
}

/**
 * Punto único de resolución de credenciales por-request para el MCP de
 * Firefly III (historia 1.5, AC #1-#4). **Epic 4** (cliente MCP real) y
 * **Epic 5** (Gemini) deben llamar a `getUserCredentials` antes de invocar
 * cualquier tool del MCP -- no reimplementar resolución de credenciales en
 * otro lugar del pipeline. El servidor MCP en sí todavía no existe en este
 * repo (Epic 4); esta historia construye y prueba solo el mecanismo de
 * resolución, aislado, con el cliente MCP mockeado en los tests.
 *
 * Sin estado de módulo ni cacheo entre invocaciones (AC #3): `deps` solo
 * fija configuración estable (repositorio, URL de Firefly III) al construir
 * el resolver -- el PAT en sí nunca se guarda en una variable compartida
 * entre llamadas, cada `getUserCredentials(chatId)` lo resuelve desde cero.
 */
export function createCredentialResolver(deps: CredentialResolverDeps) {
  return {
    async getUserCredentials(chatId: number): Promise<CredencialesUsuario> {
      let pat: string | null;
      try {
        pat = await deps.usuariosRepository.obtenerPatDescifrado(chatId);
      } catch (error) {
        // PAT corrupto o clave de cifrado equivocada (PatCryptoError de 1.4)
        // u otro fallo al resolverlo: nunca dejar escapar la excepción sin
        // manejar, ni mucho menos hacer fallback a otro PAT -- se trata
        // como "sin credenciales" (AC #4) y se corta antes del MCP.
        logger.error(
          { chat_id: chatId, err: error instanceof Error ? error : new Error(String(error)) },
          "Fallo al resolver el PAT del usuario, se niega la credencial (fail closed)",
        );
        pat = null;
      }

      if (!pat) {
        throw new CredencialesNoDisponiblesError(chatId);
      }

      return { pat, fireflyUrl: deps.fireflyUrl };
    },
  };
}

export type CredentialResolver = ReturnType<typeof createCredentialResolver>;
