import { describe, expect, it } from "vitest";
import {
  construirContents,
  construirLineaFechaActual,
  construirSystemPromptEstable,
} from "../../src/gemini/promptBuilder.js";
import type { HistorialMensaje } from "../../src/conversation/historyStore.js";

describe("construirSystemPromptEstable", () => {
  it("nunca incluye la fecha/hora actual (debe quedar 100% estable para el cache de contexto de Gemini)", () => {
    const prompt = construirSystemPromptEstable();
    expect(prompt).not.toContain("Fecha y hora actual:");
  });

  it("es byte-idéntico entre llamadas (requisito del cache de contexto)", () => {
    expect(construirSystemPromptEstable()).toBe(construirSystemPromptEstable());
  });

  it("instruye a no revelar tokens/credenciales ni JSON crudo (mismo criterio que 4.3)", () => {
    const prompt = construirSystemPromptEstable();
    expect(prompt.toLowerCase()).toContain("token");
    expect(prompt.toLowerCase()).toContain("json crudo");
  });
});

describe("construirLineaFechaActual", () => {
  it("incluye la fecha/hora actual en formato ISO (tarea explícita de 5.1)", () => {
    const fecha = new Date("2026-09-13T12:00:00.000Z");
    expect(construirLineaFechaActual(fecha)).toContain("2026-09-13T12:00:00.000Z");
  });
});

describe("construirContents", () => {
  it("con historial vacío, antepone la fecha actual y arma un único turno con el mensaje nuevo", () => {
    const resultado = construirContents([], "cuánto gasté este mes?", "Fecha y hora actual: 2026-09-13T12:00:00.000Z");
    expect(resultado).toEqual([
      { role: "user", parts: [{ text: "Fecha y hora actual: 2026-09-13T12:00:00.000Z" }] },
      { role: "user", parts: [{ text: "cuánto gasté este mes?" }] },
    ]);
  });

  it("con historial previo, antepone la fecha, preserva rol del historial y agrega el mensaje nuevo al final", () => {
    const historial: HistorialMensaje[] = [
      { rol: "user", contenido: "hola", timestamp: "2026-09-13T11:00:00.000Z" },
      { rol: "model", contenido: "hola, en qué te ayudo?", timestamp: "2026-09-13T11:00:01.000Z" },
    ];

    const resultado = construirContents(
      historial,
      "registrame un gasto de 5000 en almuerzo",
      "Fecha y hora actual: 2026-09-13T12:00:00.000Z",
    );

    expect(resultado).toEqual([
      { role: "user", parts: [{ text: "Fecha y hora actual: 2026-09-13T12:00:00.000Z" }] },
      { role: "user", parts: [{ text: "hola" }] },
      { role: "model", parts: [{ text: "hola, en qué te ayudo?" }] },
      { role: "user", parts: [{ text: "registrame un gasto de 5000 en almuerzo" }] },
    ]);
  });
});
