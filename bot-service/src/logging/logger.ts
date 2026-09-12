export interface LogContext {
  [key: string]: unknown;
}

/**
 * Logger mínimo en JSON por línea, alcance acotado a lo que pide la historia 2.3
 * (AC #4: que un fallo de procesamiento asíncrono quede registrado para
 * diagnóstico). La estrategia de logging estructurado completa del Bot Service
 * es la historia 8.1 (logs-estructurados) — este módulo queda como base y no
 * anticipa esa historia.
 */
function log(level: "info" | "error", message: string, context?: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, context?: LogContext): void => log("info", message, context),
  error: (message: string, context?: LogContext): void => log("error", message, context),
};
