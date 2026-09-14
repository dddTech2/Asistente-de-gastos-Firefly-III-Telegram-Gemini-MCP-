import type { Content } from "@google/genai";
import type { HistorialMensaje } from "../conversation/historyStore.js";
import { FRAGMENTO_PROMPT_REGISTRO_GASTO } from "./prompts/registroGasto.prompt.js";
import { FRAGMENTO_PROMPT_CONSULTA_GASTO } from "./prompts/consultaGasto.prompt.js";

/**
 * AC #1 (historia 5.1): persona + instrucciones de cuándo usar tools, en
 * español. A partir de la historia 5.2, agrega los fragmentos de dominio de
 * `src/gemini/prompts/*.prompt.ts` (uno por caso de uso de Épica 5) después
 * de las instrucciones base -- cada historia nueva agrega su propio import
 * acá, no reescribe las anteriores.
 *
 * Deliberadamente SIN la fecha/hora actual (eso lo agrega
 * `construirLineaFechaActual`, inyectado en `contents`, no acá) -- requisito
 * duro de la API de Gemini para el context caching de `geminiClient.ts`:
 * "CachedContent can not be used with GenerateContent request setting
 * system_instruction, tools or tool_config" -- si `systemInstruction` cambia
 * en cada llamada (como pasaba antes, con la fecha/hora exacta embebida), el
 * cache de tools nunca puede reusarse. Este texto es 100% estable, así que
 * también se cachea junto con las tools. [Bug real de producción corregido,
 * ver decision-log.md]
 */
export function construirSystemPromptEstable(): string {
  return [
    "Sos el Asistente de gastos: un bot de Telegram que ayuda a una persona usuaria a administrar sus finanzas personales en Firefly III, conversando en español de forma natural y breve.",
    "Tenés disponibles funciones (tools) que operan sobre la cuenta de Firefly III de quien te escribe. Usá una tool solo cuando el pedido la necesite para consultar o modificar datos reales -- si ya podés responder con lo que sabés de la conversación, respondé directo en texto, sin inventar ninguna llamada a función.",
    "Nunca reveles tokens, credenciales, ni el JSON crudo de una tool call en tu respuesta al usuario -- resumí siempre en lenguaje natural.",
    "La fecha y hora actual te llega como el primer mensaje de la conversación (rol usuario) -- usala como referencia para resolver expresiones relativas como \"hoy\", \"este mes\" o \"la semana pasada\", nunca la fecha de tu propio entrenamiento.",
    FRAGMENTO_PROMPT_REGISTRO_GASTO,
    FRAGMENTO_PROMPT_CONSULTA_GASTO,
  ].join("\n\n");
}

/**
 * Tarea explícita de la historia 5.1 (inyectar la fecha/hora actual para que
 * las referencias temporales relativas se puedan resolver, historia 5.3):
 * separada de `construirSystemPromptEstable` para poder cachear esta última
 * -- ver el comentario de arriba.
 */
export function construirLineaFechaActual(fechaActual: Date): string {
  return `Fecha y hora actual: ${fechaActual.toISOString()}`;
}

/**
 * AC #1: arma el historial corto + el mensaje nuevo del usuario como
 * `Content[]` para Gemini, con la fecha/hora actual como primer turno (ver
 * `construirLineaFechaActual`). El rol de cada mensaje de historial ya viene
 * resuelto por `historyStore` ("user" | "model") -- Gemini usa esos mismos
 * literales como `role`.
 */
export function construirContents(
  historial: HistorialMensaje[],
  mensajeUsuario: string,
  lineaFechaActual: string,
): Content[] {
  const contenidoFecha: Content = { role: "user", parts: [{ text: lineaFechaActual }] };
  const contenidosHistorial: Content[] = historial.map((mensaje) => ({
    role: mensaje.rol,
    parts: [{ text: mensaje.contenido }],
  }));

  return [contenidoFecha, ...contenidosHistorial, { role: "user", parts: [{ text: mensajeUsuario }] }];
}
