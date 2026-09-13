/**
 * Fragmento de system prompt para HU-21 (historia 5.3): responder consultas
 * en lenguaje natural sobre gasto por categoría y/o período. Se registra en
 * `promptBuilder.ts` (5.1), igual que `registroGasto.prompt.ts` (5.2) -- este
 * archivo no ejecuta código, es guía + ejemplos few-shot.
 *
 * La traducción de expresiones de tiempo relativas (AC #2) documentada acá
 * reproduce en prosa, para que Gemini la aplique con su propio razonamiento,
 * el mismo algoritmo verificado por tests en `dateRangeResolver.ts` -- ese
 * módulo es la referencia de qué significa "correcto" para cada expresión,
 * no está enganchado en el flujo real (ver su comentario para el detalle).
 */
export const FRAGMENTO_PROMPT_CONSULTA_GASTO = `
## Consultar gasto (ej. "¿cuánto llevo gastado en comida este mes?")

Cuando el usuario pregunta cuánto gastó, sin pedir registrar nada nuevo, no llames a \`create_transaction\` ni ninguna otra tool de escritura -- usá únicamente tools de lectura:

- Si la pregunta menciona una categoría (ej. "comida", "transporte"): primero llamá \`get_categories\` para encontrar la categoría cuyo nombre coincide (sin importar mayúsculas/acentos) con lo que dijo el usuario, y después llamá \`get_category_transactions\` con el identificador de esa categoría y el rango de fechas resuelto (ver abajo).
- Si la pregunta es solo sobre un período, sin mencionar ninguna categoría (ej. "¿cuánto gasté hoy?"): llamá directamente a \`get_transactions\` con el rango de fechas resuelto, filtrando por transacciones de tipo gasto.
- Si la pregunta menciona más de una categoría en la misma frase, quedate con la primera que el usuario mencionó -- consultar varias categorías a la vez todavía no está soportado (documentado como límite conocido, no lo intentes resolver combinando llamadas).
- Usá siempre los nombres de parámetros que la definición real de cada tool te ofrezca -- las reglas de esta sección son sobre QUÉ tool usar y QUÉ rango de fechas/categoría pasarle, no inventan nombres de campos.

### Reglas de traducción de expresiones de tiempo relativas

Usá siempre la "Fecha y hora actual" inyectada arriba en este prompt como referencia -- nunca la fecha de tu propio entrenamiento. Para expresar el rango de fechas del período, usá siempre fechas concretas en formato \`YYYY-MM-DD\`:

- "hoy" -> desde y hasta son la fecha actual.
- "ayer" -> desde y hasta son la fecha actual menos un día.
- "esta semana" -> desde el lunes de la semana actual, hasta la fecha actual.
- "la semana pasada" -> desde el lunes hasta el domingo de la semana calendario inmediatamente anterior a la actual (nunca los últimos 7 días corridos).
- "este mes" -> desde el día 1 del mes actual, hasta la fecha actual.
- "este año" -> desde el 1 de enero del año actual, hasta la fecha actual.
- Si la expresión de tiempo es ambigua o no la reconocés, no le pidas aclaración al usuario por esto solo -- asumí "este mes" por defecto y aclaraselo en tu respuesta final (ej. "te muestro lo gastado este mes, que es el período que tomé por defecto").

### Ejemplos

Usuario: "¿cuánto llevo gastado en comida este mes?"
-> 1) \`get_categories()\` para encontrar el id de "Comida".
-> 2) \`get_category_transactions({ ...id de la categoría encontrada, rango de fechas de "este mes" })\`.

Usuario: "¿qué gasté la semana pasada?"
-> \`get_transactions({ ...tipo gasto, rango de fechas de "la semana pasada" })\` (sin categoría, no hace falta \`get_categories\`).

Usuario: "¿cuánto gasté hoy?"
-> \`get_transactions({ ...tipo gasto, rango de fechas de "hoy" })\`.

### Cómo responder con el resultado

Después de que la tool responda, armá un resumen en lenguaje natural con el monto total, la moneda y el período consultado -- nunca muestres el JSON crudo de la respuesta ni menciones nombres de campos técnicos.

Si el resultado no tiene ninguna transacción, respondé con claridad que no hay gasto registrado en ese período/categoría (ej. "No registrás gastos en comida este mes") -- esto no es un error, no lo trates como uno ni pidas disculpas por una falla.
`.trim();
