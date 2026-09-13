# Cobertura del MCP de Firefly III frente al catálogo completo (historia 4.4)

Auditoría de las 140 tools del MCP (`daften/fireflyiii-mcp`, desplegado en 4.1, catalogadas
en 4.2 por tipo de operación) contra los **7 grupos funcionales** acordados con el usuario en
la corrección de rumbo del 2026-09-13 (transacciones avanzadas, cuentas/pasivos,
categorías/tags, presupuestos/piggy banks, automatización, multi-moneda, reportes/insights).
Es el insumo directo de las historias 5.6-5.12: cada una debe citar este documento en vez de
re-explorar el MCP por separado.

## Metodología

Mismo criterio que el spike 1.2: verificado contra el comportamiento real del MCP desplegado
en producción, no contra su documentación. Concretamente:

1. `tools/list` completo re-verificado vía MCP Inspector CLI (140 tools, coincide con 4.2).
2. JSON Schema real (`inputSchema`) de las tools con ambigüedad de cobertura, extraído del
   mismo `tools/list` (no de la documentación del proyecto upstream).
3. Invocaciones reales (`tools/call`) contra la instancia de desarrollo, con datos de prueba,
   para los dos casos límite más relevantes: transacción split y cuenta de tipo `liability`.

## Resumen por grupo

| # | Grupo | Tools | Veredicto |
|---|---|---|---|
| 1 | Transacciones avanzadas (ingreso, transferencia, split, reconciliación) | 15 | **Cubierto parcialmente** |
| 2 | Cuentas de activo y pasivos/deudas | 8 | **Cubierto parcialmente** |
| 3 | Categorías, tags y grupos de objetos | 20 | Cubierto |
| 4 | Presupuestos, auto-budget y piggy banks | 21 | Cubierto |
| 5 | Bills/suscripciones, recurrentes y reglas | 30 | Cubierto |
| 6 | Multi-moneda (cuentas y transacciones) | 9 | **Cubierto parcialmente** |
| 7 | Reportes, búsqueda e insights | 29 | Cubierto |
| — | Fuera de los 7 grupos (adjuntos, info de sistema) | 8 | N/A — fuera del alcance de Épica 5 |

Total: 15+8+20+21+30+9+29+8 = 140.

## 1. Transacciones avanzadas — cubierto parcialmente

**Tools:** `get_link_types`, `get_transaction`, `get_transaction_link`, `get_transaction_links`,
`get_transactions`, `get_transactions_without_budget`, `export_transactions`,
`create_split_transaction`, `create_transaction`, `create_transaction_link`,
`update_transaction`, `update_transaction_link`, `bulk_update_transactions`,
`delete_transaction`, `delete_transaction_link`.

- **Ingreso (deposit) / transferencia (transfer): cubierto.** El `type` de
  `create_transaction`/`update_transaction`/`create_split_transaction` acepta
  `["withdrawal", "deposit", "transfer"]` (schema real) — no hace falta ninguna tool
  adicional, solo indicarle a Gemini el `type` correcto (mismo patrón que 5.2 con
  `withdrawal`).
- **Split: cubierto, con una particularidad a documentar para 5.6.** Probado en vivo
  (`create_split_transaction` con 2 splits, `source_id: "1"`) — falló primero con
  `"Validation failed: group_title — Un título de grupo es obligatorio cuando hay más de
  una transacción."` pese a que el schema del MCP marca `group_title` como **opcional**
  (bug de validación de terceros: el schema no refleja que Firefly lo exige a partir de 2
  splits). Repetido con `group_title` incluido: creó la transacción real
  (`transaction_journal_id: "6"`, dos splits, `source_balance_after` actualizado). **5.6 debe
  incluir siempre un `group_title` por defecto cuando arme una tool call con 2+ splits** — es
  un ajuste de prompt/orquestación, no requiere tocar el MCP.
- **Reconciliación: NO cubierto.** `update_transaction` y `bulk_update_transactions` **no
  tienen ningún campo `reconciled`** en su `inputSchema` real (verificado, no hay
  `reconciled` en ninguna de las dos). Esto contradice el supuesto usado en
  `bot-service/src/mcp/toolClassification.ts` (historia 4.3), que clasifica
  `update_transaction`/`bulk_update_transactions` como irreversibles **solo si**
  `args.reconciled === true` — ese chequeo hoy es código muerto en la práctica: como el
  campo no existe en el schema que Gemini recibe, nunca debería llegar un `reconciled` real
  en una tool call legítima. No es un bug que rompa nada (es un fail-safe que simplemente no
  tiene con qué activarse todavía), pero significa que **reconciliar una transacción por chat
  no es posible hoy**, y quedará automáticamente resuelto el día que el MCP exponga el campo
  (la lógica de 4.3 ya está lista para ese momento, sin cambios).
- **Recomendación (AC #3):** **extender el MCP** (`daften/fireflyiii-mcp` es open-source) para
  agregar `reconciled: boolean` a `update_transaction` y `bulk_update_transactions`,
  reenviándolo tal cual al campo `reconciled` de la API de transacciones de Firefly III. Un
  cliente REST directo sería redundante: el resto de la edición de transacciones ya pasa por
  este MCP, duplicar el cliente solo para un campo no se justifica.

## 2. Cuentas de activo y pasivos/deudas — cubierto parcialmente

**Tools:** `get_account`, `get_account_overview_chart`, `get_account_transactions`,
`get_accounts`, `export_accounts`, `create_account`, `update_account`, `delete_account`.

- **Cuentas de activo (asset/expense/revenue): cubierto.** CRUD completo, ya verificado
  funcionalmente en 4.1/4.2 (`get_accounts`/`create_transaction` contra una cuenta real).
- **Pasivos/deudas (liability): NO cubierto en la práctica.** `get_accounts` sí filtra por
  `type: liability`, pero **`create_account`/`update_account` no tienen ningún campo
  `liability_type` ni `liability_direction`** en su `inputSchema`. Probado en vivo:
  `create_account({name: "deuda test 4.4", type: "liability"})` (únicos campos que el schema
  permite) fue rechazado por Firefly III: `"Validation failed: liability_type — El campo
  liability type es obligatorio cuando el campo type es liability.; liability_direction — El
  campo liability direction es obligatorio cuando el campo type es liability."` Es
  estructuralmente imposible crear una cuenta de deuda funcional con este MCP tal cual está
  desplegado — no es una limitación de prompt, no hay ningún argumento que se le pueda pasar
  para resolverlo.
- **Recomendación (AC #3):** **extender el MCP**, agregando `liability_type`
  (`debt`/`loan`/`mortgage`/`creditCard`, según la API de Firefly), `liability_direction`
  (`credit`/`debit`) y opcionalmente `interest`/`interest_period` a `create_account` y
  `update_account`. Es forwarding directo de campos ya soportados por la API REST de Firefly
  III, no lógica de negocio nueva -- coherente con extender en vez de duplicar con un cliente
  REST aparte.

## 3. Categorías, tags y grupos de objetos — cubierto

**Tools (20):** CRUD completo para `category` (`get/create/update/delete/export_categories`,
`get_category_transactions`, `get_category_chart`), `tag` (`get/create/update/delete_tag`,
`get_tag_transactions`, `export_tags`) y `object_group` (`get/create/update/delete_object_group`,
`get_object_groups`, `get_object_group_bills`, `get_object_group_piggy_banks`). Sin ambigüedad
de cobertura detectada en los nombres ni necesidad de revisar schemas — 5.8 puede construirse
directo sobre estas tools.

## 4. Presupuestos, auto-budget y piggy banks — cubierto

**Tools (21):** CRUD completo de `budget` y `budget_limit`, más `piggy_bank`/`piggy_bank_event`.
**Auto-budget confirmado en el schema real** de `create_budget`/`update_budget`:
`auto_budget_type` (`reset`/`rollover`/`none`), `auto_budget_currency_code`,
`auto_budget_amount`, `auto_budget_period`
(`daily`/`weekly`/`monthly`/`quarterly`/`half_year`/`yearly`) — están todos. 5.9 puede
construirse directo sobre estas tools, sin extender nada.

## 5. Bills/suscripciones, transacciones recurrentes y reglas — cubierto

**Tools (30):** CRUD completo de `bill`, `recurring` (+ `trigger_recurrence`) y
`rule`/`rule_group` (+ `trigger_rule`/`trigger_rule_group`, `test_rule`/`test_rule_group` para
simular sin aplicar). Sin gaps detectados. 5.10 puede construirse directo sobre estas tools.

## 6. Multi-moneda (cuentas y transacciones) — cubierto parcialmente

**Tools:** `get_currencies`, `get_currency`, `get_exchange_rate`, `create_currency`,
`update_currency`, `enable_currency`, `disable_currency`, `set_primary_currency`.

- **Administración de monedas del sistema: cubierto.** `create_currency` (name/code/symbol/
  decimal_places/enabled/default), `enable_currency`/`disable_currency`/`set_primary_currency`
  -- CRUD completo verificado por schema.
- **Cuentas en una moneda distinta a la del sistema: cubierto.** `create_account`/
  `update_account` tienen `currency_code`.
- **Transacciones en moneda distinta a la de la cuenta (dual-amount): NO cubierto.** Ni
  `create_transaction`, ni `create_split_transaction`, ni `update_transaction` exponen
  `foreign_amount`/`foreign_currency_id` como parámetro de entrada -- solo un `currency_code`
  único (reemplaza la moneda de la transacción, no registra un monto "nativo" + uno
  "extranjero" en simultáneo). Confirmado indirectamente: la respuesta real de
  `create_split_transaction` sí incluye `foreign_currency_id`/`foreign_amount` (ambos `null`
  en la prueba) -- Firefly los soporta y los devuelve, el MCP simplemente no los deja setear.
- **Recomendación (AC #3):** **extender el MCP**, agregando `foreign_amount` y
  `foreign_currency_id` (o `foreign_currency_code`) a `create_transaction`,
  `create_split_transaction` y `update_transaction`. Mismo criterio que los dos casos
  anteriores: forwarding de campos que la API de Firefly ya soporta.

## 7. Reportes, búsqueda e insights — cubierto

**Tools (29):** `get_balance_chart`, `get_net_worth_summary`, `get_summary`,
`search_accounts`, `search_transactions`, más las 24 tools `get_insight_*` (gastos por
cuenta/bill/budget/tag/categoría y sus variantes "no_X"/"total", ingresos, transferencias).
Cobertura amplísima -- 5.12 puede construirse directo sobre estas tools.

## Fuera de los 7 grupos (8 tools)

`get_about`, `get_attachment`, `get_attachments`, `create_attachment`, `update_attachment`,
`delete_attachment`, `upload_attachment`, `download_attachment` -- adjuntos e info de sistema,
no forman parte de ningún grupo funcional financiero y no están en el alcance de Épica 5.

## Resumen de recomendaciones para 5.6-5.11

| Gap | Ruta recomendada | Historia que lo consume |
|---|---|---|
| Reconciliación (`reconciled` ausente) | Extender el MCP | 5.6 |
| Split sin `group_title` por defecto | Ajuste de prompt/orquestación (no MCP) | 5.6 |
| Liability (`liability_type`/`liability_direction` ausentes) | Extender el MCP | 5.7 |
| Transacciones multi-moneda (`foreign_amount` ausente) | Extender el MCP | 5.11 |

Las tres extensiones al MCP son forwarding simple de campos que la API de Firefly III ya
soporta -- ninguna requiere lógica de negocio nueva del lado del MCP. Se recomienda agruparlas
en un único fork/PR sobre `daften/fireflyiii-mcp` en vez de tres cambios separados, dado que
tocan los mismos archivos (`create_account`/`update_account`/`create_transaction`/
`create_split_transaction`/`update_transaction`).
