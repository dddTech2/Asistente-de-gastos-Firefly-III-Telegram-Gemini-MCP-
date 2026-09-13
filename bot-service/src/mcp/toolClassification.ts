/**
 * Clasificación irreversible/reversible del catálogo de tools del MCP de
 * Firefly III (historia 4.2 -- ver mcp/tools-inventory.md para el catálogo
 * completo verificado contra el MCP real, 140 tools).
 *
 * Criterio (AC #1 de la historia 4.3): "irreversible" es borrado de cualquier
 * entidad, reconciliación, o cualquier operación sin un "deshacer" razonable
 * dentro de Firefly III; "reversible" es todo lo demás (lectura, creación,
 * edición normal).
 *
 * Tres reglas, en este orden:
 * 1. Las 16 tools `delete_*` son irreversibles siempre.
 * 2. Las 3 tools `trigger_*` (trigger_rule, trigger_rule_group,
 *    trigger_recurrence) son irreversibles: ejecutan una regla/recurrencia ya
 *    configurada en Firefly III, cuyas acciones (definidas por el usuario, no
 *    visibles para el MCP) pueden incluir borrados en cascada. No hay forma
 *    de saber desde el nombre de la tool si el efecto real es inocuo o
 *    destructivo, así que se trata como irreversible por default. [Inference,
 *    ver Dev Agent Record de esta historia para el detalle]
 * 3. `update_transaction` y `bulk_update_transactions` son irreversibles
 *    SOLO cuando alguno de los argumentos marca `reconciled: true` -- el
 *    resto de sus usos (editar monto, descripción, etc.) es reversible. Es
 *    el único caso donde la clasificación depende de los argumentos, no solo
 *    del nombre de la tool, porque Firefly III no tiene una tool
 *    "reconcile_transaction" separada: la reconciliación es un campo dentro
 *    de estas dos tools genéricas.
 *
 * Fail-safe: cualquier tool que no esté en el catálogo conocido de 4.2 (por
 * ejemplo, una agregada por una versión futura del MCP) se clasifica como
 * irreversible por default -- mismo criterio fail-safe que
 * `credential-resolver.ts` (historia 1.5): mejor pedir confirmación de más
 * que ejecutar sin control una tool nueva y no auditada.
 */

export type ClasificacionTool = "irreversible" | "reversible";

const TOOLS_LECTURA = [
  "get_about", "get_account", "get_account_overview_chart", "get_account_transactions",
  "get_accounts", "get_attachment", "get_attachments", "get_available_budget",
  "get_available_budgets", "get_balance_chart", "get_bill_transactions", "get_bills",
  "get_budget_chart", "get_budget_limits", "get_budget_transactions", "get_budgets",
  "get_categories", "get_category_chart", "get_category_transactions", "get_currencies",
  "get_currency", "get_exchange_rate", "get_insight_expenses",
  "get_insight_expenses_by_asset", "get_insight_expenses_by_bill",
  "get_insight_expenses_by_budget", "get_insight_expenses_by_expense_account",
  "get_insight_expenses_by_tag", "get_insight_expenses_no_bill",
  "get_insight_expenses_no_budget", "get_insight_expenses_no_category",
  "get_insight_expenses_no_tag", "get_insight_expenses_total", "get_insight_income",
  "get_insight_income_by_asset", "get_insight_income_by_revenue",
  "get_insight_income_by_tag", "get_insight_income_no_category",
  "get_insight_income_no_tag", "get_insight_income_total",
  "get_insight_transfer_no_category", "get_insight_transfer_no_tag",
  "get_insight_transfers_by_asset", "get_insight_transfers_by_category",
  "get_insight_transfers_by_tag", "get_insight_transfers_total", "get_link_types",
  "get_net_worth_summary", "get_object_group", "get_object_group_bills",
  "get_object_group_piggy_banks", "get_object_groups", "get_piggy_bank_events",
  "get_piggy_banks", "get_recurrence", "get_recurrence_transactions", "get_recurring",
  "get_rule", "get_rule_group", "get_rule_group_rules", "get_rule_groups", "get_rules",
  "get_summary", "get_tag_transactions", "get_tags", "get_transaction",
  "get_transaction_link", "get_transaction_links", "get_transactions",
  "get_transactions_without_budget", "search_accounts", "search_transactions",
  "export_accounts", "export_bills", "export_budgets", "export_categories",
  "export_piggy_banks", "export_recurring", "export_rules", "export_tags",
  "export_transactions", "download_attachment", "test_rule", "test_rule_group",
] as const;

const TOOLS_ESCRITURA_REVERSIBLE = [
  "create_account", "create_attachment", "create_bill", "create_budget",
  "create_budget_limit", "create_category", "create_currency", "create_object_group",
  "create_piggy_bank", "create_piggy_bank_event", "create_recurring", "create_rule",
  "create_rule_group", "create_split_transaction", "create_tag", "create_transaction",
  "create_transaction_link", "update_account", "update_attachment", "update_bill",
  "update_budget", "update_budget_limit", "update_category", "update_currency",
  "update_object_group", "update_piggy_bank", "update_recurring", "update_rule",
  "update_rule_group", "update_tag", "update_transaction_link", "upload_attachment",
  "enable_currency", "disable_currency", "set_primary_currency",
  // update_transaction y bulk_update_transactions NO están acá: su
  // clasificación depende de los argumentos (ver TOOLS_RECONCILIABLES abajo).
] as const;

const TOOLS_DESTRUCTIVAS = [
  "delete_account", "delete_attachment", "delete_bill", "delete_budget",
  "delete_budget_limit", "delete_category", "delete_currency", "delete_object_group",
  "delete_piggy_bank", "delete_piggy_bank_event", "delete_recurring", "delete_rule",
  "delete_rule_group", "delete_tag", "delete_transaction", "delete_transaction_link",
] as const;

const TOOLS_AUTOMATIZACION_IRREVERSIBLE = [
  "trigger_recurrence", "trigger_rule", "trigger_rule_group",
] as const;

/** Su clasificación depende de si el argumento marca `reconciled: true`. */
const TOOLS_RECONCILIABLES = ["update_transaction", "bulk_update_transactions"] as const;

const CATALOGO_CONOCIDO = new Set<string>([
  ...TOOLS_LECTURA,
  ...TOOLS_ESCRITURA_REVERSIBLE,
  ...TOOLS_DESTRUCTIVAS,
  ...TOOLS_AUTOMATIZACION_IRREVERSIBLE,
  ...TOOLS_RECONCILIABLES,
]);

const TOOLS_SIEMPRE_IRREVERSIBLES = new Set<string>([
  ...TOOLS_DESTRUCTIVAS,
  ...TOOLS_AUTOMATIZACION_IRREVERSIBLE,
]);

const TOOLS_RECONCILIABLES_SET = new Set<string>(TOOLS_RECONCILIABLES);

function marcaReconciliacion(args: Record<string, unknown>): boolean {
  if (args.reconciled === true) {
    return true;
  }

  // bulk_update_transactions agrupa los cambios en un array `transactions`.
  const transacciones = args.transactions;
  if (Array.isArray(transacciones)) {
    return transacciones.some(
      (t) => typeof t === "object" && t !== null && (t as Record<string, unknown>).reconciled === true,
    );
  }

  return false;
}

/**
 * Clasifica una tool call como irreversible o reversible. `args` son los
 * argumentos con los que se va a invocar la tool -- solo se inspeccionan
 * para `update_transaction`/`bulk_update_transactions` (caso reconciliación);
 * el resto de la clasificación depende únicamente de `toolName`.
 */
export function clasificarToolCall(toolName: string, args: Record<string, unknown> = {}): ClasificacionTool {
  if (TOOLS_SIEMPRE_IRREVERSIBLES.has(toolName)) {
    return "irreversible";
  }

  if (TOOLS_RECONCILIABLES_SET.has(toolName)) {
    return marcaReconciliacion(args) ? "irreversible" : "reversible";
  }

  if (!CATALOGO_CONOCIDO.has(toolName)) {
    return "irreversible";
  }

  return "reversible";
}
