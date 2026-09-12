import pino, { type DestinationStream, type Logger } from "pino";
import { logLevel, type LogLevel } from "../config/logging.config.js";

/**
 * Paths de fast-redact (motor de redacción de pino). Cubren el campo top-level
 * y un nivel de anidamiento — es lo que realmente puede aparecer en los objetos
 * que este servicio pasa al logger (no hace falta un wildcard recursivo porque
 * los call sites son controlados por este mismo código, no datos arbitrarios
 * de terceros). AC #4: PAT de Firefly, API key de Gemini y token de Telegram
 * nunca deben salir en texto plano.
 */
const REDACT_PATHS = [
  "pat",
  "*.pat",
  "token",
  "*.token",
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "headers.authorization",
];

/**
 * pino elegido sobre alternativas (winston, etc.) por su overhead bajo en el
 * hot path del webhook [Source: bmad-output/stories/8.1.logs-estructurados.story.md#tasks--subtasks].
 * `timestamp`/`level` se reformatean para que la línea JSON tenga exactamente
 * los nombres de campo que pide el AC #2 (timestamp ISO en vez del epoch `time`
 * de pino, `level` como string en vez del número interno).
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    destination,
  );
}

export const logger: Logger = createLogger(logLevel);
