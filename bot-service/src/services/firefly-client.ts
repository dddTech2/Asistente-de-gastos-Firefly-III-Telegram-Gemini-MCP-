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

export interface TransaccionResumen {
  fecha: string;
  monto: string;
  concepto: string;
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
  listarTransacciones(desde: string, hasta: string): Promise<TransaccionResumen[]>;
}

interface FireflyTransactionResponse {
  data: { id: string };
}

// Firefly III agrupa cada transacción (aun las "simples") en un array
// `attributes.transactions` de uno o más splits -- se aplana a un registro
// por split, que es lo que consume `formatMensajeResumen` (historia 3.2).
// [Inference: forma real de la API v1 de Firefly III, no deletreada en la
// documentación del proyecto -- ver Dev Notes de 3.2]
interface FireflyTransactionSplit {
  date: string;
  amount: string;
  description: string;
}

interface FireflyTransactionGroup {
  attributes: { transactions: FireflyTransactionSplit[] };
}

interface FireflyTransactionsListResponse {
  data: FireflyTransactionGroup[];
  meta: { pagination: { total_pages: number } };
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

    /**
     * `GET /api/v1/transactions?start=<desde>&end=<hasta>` (AC #1, historia
     * 3.2), `desde`/`hasta` en formato `YYYY-MM-DD`. Recorre todas las
     * páginas (`meta.pagination.total_pages`) antes de devolver el resultado
     * completo -- un mes con volumen alto de transacciones puede no entrar
     * en una sola página de Firefly III.
     */
    async listarTransacciones(desde: string, hasta: string): Promise<TransaccionResumen[]> {
      const resultados: TransaccionResumen[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const url = new URL("/api/v1/transactions", config.baseUrl);
        url.searchParams.set("start", desde);
        url.searchParams.set("end", hasta);
        url.searchParams.set("page", String(page));

        let response: Response;
        try {
          response = await fetch(url.toString(), {
            headers: {
              Authorization: `Bearer ${config.pat}`,
              Accept: "application/vnd.api+json",
            },
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
            `Firefly III respondió ${response.status} al listar transacciones`,
            response.status,
          );
        }

        const body = (await response.json()) as FireflyTransactionsListResponse;
        for (const grupo of body.data) {
          for (const split of grupo.attributes.transactions) {
            resultados.push({ fecha: split.date, monto: split.amount, concepto: split.description });
          }
        }

        totalPages = body.meta.pagination.total_pages;
        page += 1;
      } while (page <= totalPages);

      return resultados;
    },
  };
}
