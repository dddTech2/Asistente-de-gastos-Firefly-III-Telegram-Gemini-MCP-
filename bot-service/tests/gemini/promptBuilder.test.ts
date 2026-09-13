import { describe, expect, it } from "vitest";
import { construirContents, construirSystemPrompt } from "../../src/gemini/promptBuilder.js";
import type { HistorialMensaje } from "../../src/conversation/historyStore.js";

describe("construirSystemPrompt", () => {
  it("incluye la fecha/hora actual en formato ISO (tarea explícita de 5.1)", () => {
    const fecha = new Date("2026-09-13T12:00:00.000Z");
    const prompt = construirSystemPrompt(fecha);
    expect(prompt).toContain("2026-09-13T12:00:00.000Z");
  });

  it("instruye a no revelar tokens/credenciales ni JSON crudo (mismo criterio que 4.3)", () => {
    const prompt = construirSystemPrompt(new Date());
    expect(prompt.toLowerCase()).toContain("token");
    expect(prompt.toLowerCase()).toContain("json crudo");
  });
});

describe("construirContents", () => {
  it("con historial vacío, arma un único Content de rol user con el mensaje nuevo", () => {
    const resultado = construirContents([], "cuánto gasté este mes?");
    expect(resultado).toEqual([{ role: "user", parts: [{ text: "cuánto gasté este mes?" }] }]);
  });

  it("con historial previo, lo antepone preservando rol y agrega el mensaje nuevo al final", () => {
    const historial: HistorialMensaje[] = [
      { rol: "user", contenido: "hola", timestamp: "2026-09-13T11:00:00.000Z" },
      { rol: "model", contenido: "hola, en qué te ayudo?", timestamp: "2026-09-13T11:00:01.000Z" },
    ];

    const resultado = construirContents(historial, "registrame un gasto de 5000 en almuerzo");

    expect(resultado).toEqual([
      { role: "user", parts: [{ text: "hola" }] },
      { role: "model", parts: [{ text: "hola, en qué te ayudo?" }] },
      { role: "user", parts: [{ text: "registrame un gasto de 5000 en almuerzo" }] },
    ]);
  });
});
