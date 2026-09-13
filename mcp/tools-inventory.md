# Catálogo de tools del MCP de Firefly III (historia 4.2)

Generado con `MCP Inspector` en modo CLI (`npx @modelcontextprotocol/inspector --cli
--server-url http://127.0.0.1:3100/mcp --transport http --header "Authorization: Bearer
<PAT>" --method tools/list --format json`) contra el servicio `mcp-firefly` desplegado en
la historia 4.1. 140 tools en total. Este inventario es el insumo directo de la historia
4.3 (decide qué requiere confirmación explícita antes de ejecutarse) — no repetir esta
exploración ahí.

## Lectura (84) — sin efectos secundarios

`get_about`, `get_account`, `get_account_overview_chart`, `get_account_transactions`,
`get_accounts`, `get_attachment`, `get_attachments`, `get_available_budget`,
`get_available_budgets`, `get_balance_chart`, `get_bill_transactions`, `get_bills`,
`get_budget_chart`, `get_budget_limits`, `get_budget_transactions`, `get_budgets`,
`get_categories`, `get_category_chart`, `get_category_transactions`, `get_currencies`,
`get_currency`, `get_exchange_rate`, `get_insight_expenses`,
`get_insight_expenses_by_asset`, `get_insight_expenses_by_bill`,
`get_insight_expenses_by_budget`, `get_insight_expenses_by_expense_account`,
`get_insight_expenses_by_tag`, `get_insight_expenses_no_bill`,
`get_insight_expenses_no_budget`, `get_insight_expenses_no_category`,
`get_insight_expenses_no_tag`, `get_insight_expenses_total`, `get_insight_income`,
`get_insight_income_by_asset`, `get_insight_income_by_revenue`,
`get_insight_income_by_tag`, `get_insight_income_no_category`,
`get_insight_income_no_tag`, `get_insight_income_total`,
`get_insight_transfer_no_category`, `get_insight_transfer_no_tag`,
`get_insight_transfers_by_asset`, `get_insight_transfers_by_category`,
`get_insight_transfers_by_tag`, `get_insight_transfers_total`, `get_link_types`,
`get_net_worth_summary`, `get_object_group`, `get_object_group_bills`,
`get_object_group_piggy_banks`, `get_object_groups`, `get_piggy_bank_events`,
`get_piggy_banks`, `get_recurrence`, `get_recurrence_transactions`, `get_recurring`,
`get_rule`, `get_rule_group`, `get_rule_group_rules`, `get_rule_groups`, `get_rules`,
`get_summary`, `get_tag_transactions`, `get_tags`, `get_transaction`,
`get_transaction_link`, `get_transaction_links`, `get_transactions`,
`get_transactions_without_budget`, `search_accounts`, `search_transactions`,
`export_accounts`, `export_bills`, `export_budgets`, `export_categories`,
`export_piggy_banks`, `export_recurring`, `export_rules`, `export_tags`,
`export_transactions`, `download_attachment`, `test_rule`, `test_rule_group`

`test_rule`/`test_rule_group` simulan el match de una regla sin aplicarla — son lectura,
no escritura, pese al nombre.

## Escritura no destructiva (37) — crean o modifican datos, reversible manualmente

`create_account`, `create_attachment`, `create_bill`, `create_budget`,
`create_budget_limit`, `create_category`, `create_currency`, `create_object_group`,
`create_piggy_bank`, `create_piggy_bank_event`, `create_recurring`, `create_rule`,
`create_rule_group`, `create_split_transaction`, `create_tag`, `create_transaction`,
`create_transaction_link`, `update_account`, `update_attachment`, `update_bill`,
`update_budget`, `update_budget_limit`, `update_category`, `update_currency`,
`update_object_group`, `update_piggy_bank`, `update_recurring`, `update_rule`,
`update_rule_group`, `update_tag`, `update_transaction`, `update_transaction_link`,
`upload_attachment`, `enable_currency`, `disable_currency`, `set_primary_currency`,
`bulk_update_transactions`

## Automatización con efecto de escritura (3) — ejecutan lógica que puede modificar datos en cascada

`trigger_recurrence`, `trigger_rule`, `trigger_rule_group`

Estas tools no crean un objeto directamente: ejecutan una recurrencia o regla ya
configurada, cuyas acciones (definidas por el usuario en Firefly III) pueden crear,
modificar o incluso eliminar transacciones. Mayor riesgo que un `create_*`/`update_*`
simple porque el efecto real depende de configuración que el MCP no controla.

## Destructivas / irreversibles (16)

`delete_account`, `delete_attachment`, `delete_bill`, `delete_budget`,
`delete_budget_limit`, `delete_category`, `delete_currency`, `delete_object_group`,
`delete_piggy_bank`, `delete_piggy_bank_event`, `delete_recurring`, `delete_rule`,
`delete_rule_group`, `delete_tag`, `delete_transaction`, `delete_transaction_link`

## Verificación funcional (AC #4, #5)

- **Lectura + escritura con PAT A** (cuenta de prueba "test", `id: 1`): `get_accounts`
  devolvió la cuenta real (`current_balance: -60000.00 EUR`); `create_transaction`
  (`type: withdrawal`, `amount: "1.00"`, `source_id: "1"`) creó la transacción `id: "4"`
  en Firefly III de verdad (`source_balance_after` cambió en la respuesta).
- **Aislamiento con PAT B**: el mismo `get_accounts` con el PAT de un segundo usuario de
  prueba devolvió `"data": [], "total": 0` — cero cuentas, no solo cuentas distintas.
  Confirma que el MCP reenvía el header recibido sin cachear ni mezclar sesiones de
  Inspector, igual que se verificó en la historia 4.1.

## Manejo de errores (hallazgo adicional, no AC formal)

Una tool inexistente (`tools/call` con un nombre que no está en el catálogo) devuelve un
error JSON-RPC legible —
`{"error":{"code":"tool_not_found","message":"Tool '<nombre>' not found on server."}}`,
exit code `5` en el CLI de Inspector — sin crashear el proceso ni afectar la conexión.
Un PAT inválido/vacío devuelve `{"result":{"content":[{"type":"text","text":"Authentication
failed. Check your FIREFLY_TOKEN."}],"isError":true}}` (el mensaje menciona una variable de
entorno por el texto genérico de la librería upstream, pero el fallo es real y ocurre
por-request — no hay fallback a ningún token fijo).
