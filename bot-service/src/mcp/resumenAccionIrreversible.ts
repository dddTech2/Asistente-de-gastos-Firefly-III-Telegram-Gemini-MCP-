/**
 * AC #1 (historia 5.14): arma un resumen legible por humano de una tool call
 * irreversible para mostrárselo al usuario en el pedido de confirmación
 * (`confirmacionAccionIrreversible.solicitarConfirmacion`, historia 4.3) --
 * nunca el JSON crudo de la tool call (AC #5 de la historia 4.3, que esta
 * historia respeta sin modificar ese módulo).
 *
 * Formato genérico ("nombre de tool + lista clave: valor"), no una frase
 * natural por-tool -- cubre las 19 tools irreversibles conocidas (16
 * `delete_*` + 3 `trigger_*` + el caso de reconciliación) sin necesidad de un
 * caso especial por cada una. Redactar resúmenes más naturales por tool
 * (ej. "vas a borrar la transacción de $20.000 del 12/09") es una mejora
 * futura razonable para cuando una historia de dominio (ej. 5.6, que expone
 * `delete_transaction`) tenga el contexto de negocio para hacerlo bien.
 * [Inference]
 */
export function resumirAccionIrreversible(nombreTool: string, argumentos: Record<string, unknown>): string {
  const accion = nombreTool.replace(/_/g, " ");
  const entradas = Object.entries(argumentos);

  if (entradas.length === 0) {
    return accion;
  }

  const detalles = entradas.map(([clave, valor]) => `${clave}: ${String(valor)}`).join(", ");

  return `${accion} (${detalles})`;
}
