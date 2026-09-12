import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.js";

function captureDestination(): { destination: DestinationStream; lines: string[] } {
  const lines: string[] = [];
  const destination: DestinationStream = {
    write: (chunk: string) => {
      lines.push(chunk);
      return true;
    },
  };
  return { destination, lines };
}

describe("createLogger", () => {
  it("emite JSON parseable con timestamp (ISO), level y msg (AC #1, #2)", () => {
    const { destination, lines } = captureDestination();
    const logger = createLogger("info", destination);

    logger.info({ chat_id: 555, update_id: 7 }, "evento de prueba");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ level: "info", msg: "evento de prueba", chat_id: 555, update_id: 7 });
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
  });

  it("respeta el nivel configurado: no emite debug si el logger se creó en info (AC #3)", () => {
    const { destination, lines } = captureDestination();
    const logger = createLogger("info", destination);

    logger.debug("no deberia aparecer");
    logger.info("si deberia aparecer");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe("si deberia aparecer");
  });

  it("emite debug cuando el logger se creó con nivel debug (AC #3)", () => {
    const { destination, lines } = captureDestination();
    const logger = createLogger("debug", destination);

    logger.debug("mensaje de debug");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).level).toBe("debug");
  });

  it("redacta pat/token/apiKey/authorization sin exponerlos en texto plano (AC #4)", () => {
    const { destination, lines } = captureDestination();
    const logger = createLogger("info", destination);

    logger.info(
      {
        pat: "secreto-pat-12345",
        token: "secreto-token-67890",
        apiKey: "secreto-api-key",
        headers: { authorization: "Bearer secreto-bearer" },
      },
      "llamada con datos sensibles",
    );

    const raw = lines[0];
    expect(raw).not.toContain("secreto-pat-12345");
    expect(raw).not.toContain("secreto-token-67890");
    expect(raw).not.toContain("secreto-api-key");
    expect(raw).not.toContain("secreto-bearer");

    const entry = JSON.parse(raw);
    expect(entry.pat).toBe("[REDACTED]");
    expect(entry.token).toBe("[REDACTED]");
    expect(entry.apiKey).toBe("[REDACTED]");
    expect(entry.headers.authorization).toBe("[REDACTED]");
  });

  it("serializa errores bajo la clave err con message y stack (para excepciones no controladas)", () => {
    const { destination, lines } = captureDestination();
    const logger = createLogger("info", destination);

    logger.error({ err: new Error("fallo simulado") }, "excepcion no controlada");

    const entry = JSON.parse(lines[0]);
    expect(entry.err.message).toBe("fallo simulado");
    expect(typeof entry.err.stack).toBe("string");
  });
});
