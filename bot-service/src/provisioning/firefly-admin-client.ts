export interface FireflyAdminClientConfig {
  baseUrl: string;
  ownerToken: string;
}

export interface CrearUsuarioFireflyInput {
  email: string;
}

export interface UsuarioFirefly {
  id: string;
  email: string;
}

export class FireflyAdminClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = "FireflyAdminClientError";
  }
}

export interface FireflyAdminClient {
  crearUsuario(input: CrearUsuarioFireflyInput): Promise<UsuarioFirefly>;
}

interface FireflyUserResponse {
  data: {
    id: string;
    attributes: {
      email: string;
    };
  };
}

/**
 * Envuelve `POST /api/v1/users` con el token admin de rol "owner". No se pide
 * ningún rol especial al crear (el body no incluye `role`): el usuario nuevo
 * queda como cuenta regular, aislada de las demás — el rol "owner" es del
 * admin, no debe propagarse a los usuarios que se dan de alta.
 *
 * El spike 1.2 confirmó por auditoría de código fuente de Firefly III que este
 * endpoint jamás devuelve un PAT (el `UserTransformer` no serializa ningún
 * campo de token) [Source: docs/plan/spike-provisionamiento-pat-findings.md].
 * Por eso este cliente no intenta leer ni exponer un token de la respuesta.
 */
export function createFireflyAdminClient(config: FireflyAdminClientConfig): FireflyAdminClient {
  const usersUrl = new URL("/api/v1/users", config.baseUrl).toString();

  return {
    async crearUsuario({ email }: CrearUsuarioFireflyInput): Promise<UsuarioFirefly> {
      const response = await fetch(usersUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.ownerToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.api+json",
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new FireflyAdminClientError(
          `Firefly III respondio ${response.status} al crear el usuario`,
          response.status,
          responseBody,
        );
      }

      const body = (await response.json()) as FireflyUserResponse;
      return { id: body.data.id, email: body.data.attributes.email };
    },
  };
}
