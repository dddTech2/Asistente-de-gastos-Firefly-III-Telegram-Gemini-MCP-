export type LogLevel = "debug" | "info" | "warn" | "error";

const VALID_LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const DEFAULT_LOG_LEVEL: LogLevel = "info";

function isValidLogLevel(value: string): value is LogLevel {
  return (VALID_LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Un `LOG_LEVEL` ausente o inválido cae al default en vez de romper el arranque
 * del proceso (AC #3, edge case de Testing: "un LOG_LEVEL inválido... debe caer
 * a un default seguro en vez de crashear el proceso al arrancar").
 */
export function resolveLogLevel(rawValue: string | undefined): LogLevel {
  if (rawValue !== undefined && isValidLogLevel(rawValue)) {
    return rawValue;
  }
  return DEFAULT_LOG_LEVEL;
}

export const logLevel: LogLevel = resolveLogLevel(process.env.LOG_LEVEL);
