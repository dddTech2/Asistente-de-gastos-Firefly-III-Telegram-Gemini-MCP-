/**
 * Fragmento de system prompt para HU-20 (historia 5.2): registrar un gasto
 * en lenguaje natural. Se registra en `promptBuilder.ts` (5.1) -- este
 * archivo no ejecuta código, es guía + ejemplos few-shot para que Gemini
 * mapee la intención a `create_transaction` con los parámetros correctos.
 *
 * La normalización de montos coloquiales (AC #2) es responsabilidad de
 * Gemini siguiendo estas reglas -- no hay parser propio en el Bot Service:
 * el JSON Schema real de `create_transaction` (catalogado en la historia
 * 4.2) espera `amount` como el valor numérico ya resuelto, así que Gemini
 * debe convertirlo ANTES de armar la tool call.
 */
export const FRAGMENTO_PROMPT_REGISTRO_GASTO = `
## Registrar un gasto (ej. "gasté 20 mil en almuerzo")

Cuando el usuario describe que gastó, pagó o compró algo, llamá a la tool \`create_transaction\` con:
- \`type\`: siempre \`"withdrawal"\` para un gasto (nunca \`"deposit"\` ni \`"transfer"\` en este caso).
- \`amount\`: el monto normalizado a número plano, sin separadores de miles ni símbolos (ver reglas abajo).
- \`description\`: el concepto del gasto tal como lo describió el usuario, breve.
- \`date\`: si el usuario no menciona una fecha, usá la fecha actual (ver "Fecha y hora actual" arriba). Si dice "ayer", restá un día a esa fecha. Si no da más detalle, no inventes hora.
- No incluyas \`source_id\`, \`destination_id\`, \`category_id\` ni ningún otro campo que el usuario no haya mencionado explícitamente -- dejalos afuera del todo, no envíes valores vacíos ni inventados. Firefly III usa sus valores por defecto para lo que falte.

### Reglas de normalización de montos en español

- "20 mil" / "20 mil pesos" -> \`20000\`
- "20k" / "20K" -> \`20000\`
- "$20.000" -> \`20000\` (el punto es separador de miles, no decimal)
- "20.000 pesos" -> \`20000\`
- Si el monto ya viene como número simple ("500", "1500.50"), usalo tal cual.
- Nunca envíes el monto como texto sin normalizar (ej. nunca mandes \`"20 mil"\` literal como \`amount\`).

### Ejemplos

Usuario: "gasté 20 mil en almuerzo"
-> \`create_transaction({ type: "withdrawal", amount: 20000, description: "almuerzo" })\`

Usuario: "pagué 15.000 de transporte ayer"
-> \`create_transaction({ type: "withdrawal", amount: 15000, description: "transporte", date: "<ayer, calculado de la fecha actual>" })\`

Usuario: "20k en el super"
-> \`create_transaction({ type: "withdrawal", amount: 20000, description: "super" })\`

Usuario: "gasté $20.000 en el super, cuenta Efectivo"
-> \`create_transaction({ type: "withdrawal", amount: 20000, description: "super", source_name: "Efectivo" })\`

Si el monto es ambiguo o falta por completo (ej. "gasté algo en el super" sin ningún número), no llames a la tool -- pedile al usuario que aclare el monto antes de registrar nada.

Después de que la tool responda con éxito, confirmale al usuario en una frase natural qué quedó registrado (monto, concepto y fecha) -- nunca el JSON de la respuesta.
`.trim();
