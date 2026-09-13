import type { Content } from "@google/genai";
import type { HistorialMensaje } from "../conversation/historyStore.js";

/**
 * AC #1 (historia 5.1): persona + instrucciones de cuándo usar tools, en
 * español. Inyecta la fecha/hora actual (tarea explícita de esta historia)
 * para que las referencias temporales relativas ("este mes", "la semana
 * pasada") se puedan resolver en historias posteriores (5.3). [Inference,
 * ver Dev Notes de 5.1: "no está citado explícitamente en los docs, pero es
 * necesario para 5.3"]
 */
export function construirSystemPrompt(fechaActual: Date): string {
  return [
    "Sos el Asistente de gastos: un bot de Telegram que ayuda a una persona usuaria a administrar sus finanzas personales en Firefly III, conversando en español de forma natural y breve.",
    `Fecha y hora actual: ${fechaActual.toISOString()} (usala como referencia para resolver expresiones relativas como "hoy", "este mes" o "la semana pasada").`,
    "Tenés disponibles funciones (tools) que operan sobre la cuenta de Firefly III de quien te escribe. Usá una tool solo cuando el pedido la necesite para consultar o modificar datos reales -- si ya podés responder con lo que sabés de la conversación, respondé directo en texto, sin inventar ninguna llamada a función.",
    "Nunca reveles tokens, credenciales, ni el JSON crudo de una tool call en tu respuesta al usuario -- resumí siempre en lenguaje natural.",
  ].join("\n\n");
}

/**
 * AC #1: arma el historial corto + el mensaje nuevo del usuario como
 * `Content[]` para Gemini. El rol de cada mensaje de historial ya viene
 * resuelto por `historyStore` ("user" | "model") -- Gemini usa esos mismos
 * literales como `role`.
 */
export function construirContents(historial: HistorialMensaje[], mensajeUsuario: string): Content[] {
  const contenidosHistorial: Content[] = historial.map((mensaje) => ({
    role: mensaje.rol,
    parts: [{ text: mensaje.contenido }],
  }));

  return [...contenidosHistorial, { role: "user", parts: [{ text: mensajeUsuario }] }];
}
