import { describe, expect, it } from "vitest";
import { resolveLogLevel } from "../../src/config/logging.config.js";

describe("resolveLogLevel", () => {
  it.each(["debug", "info", "warn", "error"] as const)("acepta el nivel válido %s", (level) => {
    expect(resolveLogLevel(level)).toBe(level);
  });

  it("cae a 'info' cuando el valor es undefined (AC #3)", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
  });

  it("cae a 'info' en vez de romper con un valor inválido (AC #3, edge case)", () => {
    expect(resolveLogLevel("verbose")).toBe("info");
    expect(resolveLogLevel("")).toBe("info");
    expect(resolveLogLevel("INFO")).toBe("info");
  });
});
