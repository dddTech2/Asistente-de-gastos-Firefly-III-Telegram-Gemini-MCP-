export interface FireflyClientConfig {
  baseUrl: string;
  pat: string;
  sourceAccount: string;
}

export interface CrearTransaccionInput {
  monto: number;
  concepto: string;
}

export interface TransaccionCreada {
  id: string;
}

export class FireflyClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FireflyClientError";
  }
}

export interface FireflyClient {
  crearTransaccion(input: CrearTransaccionInput): Promise<TransaccionCreada>;
}

interface FireflyTransactionResponse {
  data: { id: string };
}

// Un poco por encima de la latencia objetivo del proyecto (<5s, ver Dev Notes
// de la historia 3.1) para no cortar de forma falsa-positiva ante un pico de
// latencia normal, pero sin dejar al usuario esperando indefinidamente si
// Firefly III no responde (circuit breaker simple). [Inference]
const TIMEOUT_MS = 8_000;

/**
 * `POST /api/v1/transactions` con `Authorization: Bearer <PAT>` (AC #1).
 * `type: "withdrawal"` es el tipo de transacción de Firefly III para un
 * gasto; `source_name` es la cuenta de activo (asset account) ya existente
 * del desarrollador (`FIREFLY_SOURCE_ACCOUNT`) y `destination_name` es el
 * concepto del gasto -- Firefly III auto-crea (o reutiliza) la cuenta de
 * gasto (expense account) con ese nombre. Payload exacto no está fijado por
 * ningún documento fuente de la historia; se infiere del patrón estándar de
 * la API de Firefly III. [Inference]
 *
 * Nunca incluye el cuerpo de la respuesta de error en el mensaje devuelto
 * (solo el status HTTP) -- defensa en profundidad además del AC #6, que en
 * la práctica lo cubre `usuarios.repository`/`REDACT_PATHS` del logger.
 */
export function createFireflyClient(config: FireflyClientConfig): FireflyClient {
  const transactionsUrl = new URL("/api/v1/transactions", config.baseUrl).toString();

  return {
    async crearTransaccion({ monto, concepto }: CrearTransaccionInput): Promise<TransaccionCreada> {
      let response: Response;
      try {
        response = await fetch(transactionsUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.pat}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.api+json",
          },
          body: JSON.stringify({
            error_if_duplicate_hash: false,
            transactions: [
              {
                type: "withdrawal",
                date: new Date().toISOString(),
                amount: monto.toString(),
                description: concepto,
                source_name: config.sourceAccount,
                destination_name: concepto,
              },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const esTimeout = error instanceof Error && error.name === "TimeoutError";
        throw new FireflyClientError(
          esTimeout ? "Firefly III no respondió a tiempo" : "No se pudo conectar con Firefly III",
        );
      }

      if (!response.ok) {
        throw new FireflyClientError(
          `Firefly III respondió ${response.status} al crear la transacción`,
          response.status,
        );
      }

      const body = (await response.json()) as FireflyTransactionResponse;
      return { id: body.data.id };
    },
  };
}
