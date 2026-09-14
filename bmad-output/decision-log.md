# Decision Log — Asistente de gastos (Firefly III + Telegram + Gemini + MCP)

A threaded, append-only record of decisions made across BMAD planning workflows.
Every later skill (brief, PRD, architecture, stories) appends here so the reasoning
behind the plan stays visible and consistent.

**How to use:** add a new entry at the top of the log (newest first). Never rewrite
or delete past entries — supersede them with a new entry that references the old one.

## Entry format

```
### YYYY-MM-DD — <short title>
- **Decision:** <what was decided>
- **Rationale:** <why; alternatives considered>
- **Made by:** <skill/workflow, e.g. bmad-init, prd, architecture>
- **Supersedes:** <link to prior entry, if any>
```

---

### 2026-09-13 — Bug de producción corregido (mismo día): el caching de tools rompía TODOS los mensajes con 400
- **Decision:** el caching se corrige para cachear `systemInstruction` JUNTO CON `tools` (nunca por
  separado), y `promptBuilder.construirSystemPromptEstable` deja de incluir la fecha/hora actual --
  esa parte dinámica ahora viaja como el primer turno de `contents` (`construirLineaFechaActual`),
  inyectado por `construirContents`.
- **Rationale:** al desplegar la entrada anterior de este log ("context caching de las 140 tools de
  Gemini"), el primer mensaje real en producción falló con `400 INVALID_ARGUMENT`: "CachedContent
  can not be used with GenerateContent request setting system_instruction, tools or tool_config" --
  un requisito duro de la API de Gemini que no estaba documentado en la investigación previa: cuando
  se usa `cachedContent`, NINGUNO de esos tres campos puede especificarse además en la request
  directa, ni siquiera si el cache no los incluye. La versión anterior cacheaba solo `tools` pero
  seguía mandando `systemInstruction` fresco en cada llamada (porque tenía la fecha/hora embebida) --
  eso rompía CADA mensaje, no un caso borde. Corregido moviendo la fecha/hora fuera de
  `systemInstruction` (que ahora es 100% estable y se cachea completo junto con las tools) y hacia
  `contents`, que sí puede variar libremente en cada llamada sin invalidar el cache. TTL del cache
  subido de 1h a 24h ya que ahora el contenido cacheado genuinamente no cambia salvo que el catálogo
  de tools cambie. 2 tests nuevos en `geminiClient.test.ts` (systemInstruction distinto -> cache
  nuevo; nunca manda systemInstruction/tools junto con cachedContent) + `promptBuilder.test.ts` y
  `messageOrchestrator.test.ts` actualizados a la nueva forma de `contents`.
- **Supersedes:** la entrada de arriba ("Optimización de costo: context caching de las 140 tools de
  Gemini"), cuyo diseño de caching (cachear solo `tools`) resultó incompatible con un requisito duro
  de la API que no se había verificado empíricamente antes de desplegar.
- **Made by:** dev (bug reportado en logs de producción por el usuario, mismo día del despliegue
  anterior)

---

### 2026-09-13 — Optimización de costo: context caching de las 140 tools de Gemini
- **Decision:** `geminiClient.ts` cachea explícitamente las declaraciones de tools
  (`ai.caches.create`) y las referencia vía `cachedContent` en vez de reenviar el JSON Schema
  completo de las 140 tools del MCP de Firefly III en cada llamada. Cache compartido por proceso
  (no por usuario/chat_id), TTL 1h con renovación perezosa al expirar o si el catálogo de tools
  cambia (detectado por fingerprint). Se cachea SOLO `tools`, no `systemInstruction` (que cambia de
  contenido en cada llamada por la fecha/hora inyectada). Si `tools` viene vacío -- la llamada final
  forzada sin tools del fix de "no pude terminar tu pedido", ver entrada de abajo -- nunca se crea
  ni se reutiliza cache, a propósito: reusar un cache con tools ahí resucitaría la posibilidad de que
  Gemini pida otra tool call, deshaciendo ese fix. Si crear/renovar el cache falla, se degrada a
  enviar las tools sin cachear (fail-safe, nunca corta la respuesta al usuario).
- **Rationale:** el usuario reportó vía `reporte-tokens` (historia 8.7) que 4 llamadas de un mismo
  mensaje consumieron 104.657 tokens de entrada. Investigación (con research de estrategias externas
  -- ver fuentes en la respuesta al usuario) confirmó la causa: el catálogo completo de 140 tools de
  Firefly III (84 lectura + 37 escritura + 3 automatización + 16 destructivas, historia 4.2) se
  reenvía completo en cada una de las N rondas del mismo ciclo de tool-calling, sea o no relevante
  para el mensaje. Se evaluaron 4 estrategias (búsqueda diferida de tools al estilo Anthropic Tool
  Search, Tool RAG con embeddings, ruteo estático por categoría reusando la clasificación de 4.4, y
  context caching); se eligió caching por ser la de menor riesgo/esfuerzo -- no cambia qué tools ve
  Gemini (cero impacto en precisión de selección de tool, a diferencia de RAG/ruteo) y queda
  totalmente contenida en `geminiClient.ts`, sin tocar `messageOrchestrator.ts`, la clasificación de
  irreversibles (4.3) ni la confirmación (5.14). Se agregó `cachedTokens` a la auditoría de 8.7
  (migración `0004`) para poder verificar en producción, con datos reales, que el caching efectivamente
  reduce el costo.
- **Made by:** dev (pedido explícito del usuario: "si procede", tras research conjunta de
  estrategias de la industria para reducir tokens de tool-calling con catálogos grandes)

---

### 2026-09-13 — Bug de producción corregido: "no pude terminar tu pedido" pese a que la acción ya se había ejecutado
- **Decision:** al agotar `MAX_RONDAS_TOOL_CALL` (4) sin que Gemini devuelva una respuesta de
  texto, `ejecutarRondas` ya no corta directo con el mensaje de fallback genérico -- fuerza UNA
  llamada extra a Gemini con `tools: []` (no puede pedir otra tool call sin tools declaradas) para
  que resuma en texto real lo que ya pasó, usando los resultados de tool acumulados en `contents`.
- **Rationale:** el usuario reportó (con logs de producción) que el bot dijo "no pude terminar de
  procesar tu pedido" después de una secuencia de 4 tool calls donde la ÚLTIMA (`create_transaction`)
  tuvo éxito -- el gasto quedó registrado en Firefly III, pero el usuario recibió un mensaje que
  sugería lo contrario. Riesgo real: si el usuario le cree al mensaje y reintenta, duplica el gasto.
  Causa: el tope de rondas se agotaba en una tool call exitosa sin dejar una ronda más para que
  Gemini lo confirmara en texto. La llamada final forzada sin tools es estrictamente acotada (no
  puede volver a pedir una tool call, así que nunca alarga el ciclo más de 1 llamada extra) y
  además mejora los casos de fallo genuino: si ninguna tool tuvo éxito, Gemini igual puede explicar
  en lenguaje natural qué faltó, en vez de un mensaje canónico sin contexto.
- **Made by:** dev (bug reportado en logs de producción por el usuario, con pedido explícito
  "arreglemos el bug")

---

### 2026-09-13 — Nueva historia 8.7 agregada y cerrada: auditoría de tokens de Gemini por conversación y por mes
- **Decision:** se agrega `8.7.auditoria-tokens-gemini` a Épica 8, se implementa y se cierra en la
  misma sesión, a pedido explícito del usuario. Tabla nueva `log_uso_tokens_gemini` en Postgres
  (migración `0003`), función pura `extraerUsoTokens` que lee `GenerateContentResponse.usageMetadata`
  (nunca antes leído en el proyecto), repositorio con `resumenPorChat`/`resumenPorRango`, enganchado en
  `messageOrchestrator.ejecutarRondas` de forma FAIL-SAFE (no fail-loud), y un CLI
  (`scripts/reporte-tokens.ts`) para consultar el consumo agregado sin escribir SQL a mano.
- **Rationale:** el usuario preguntó explícitamente si había alguna auditoría de tokens de
  entrada/salida por interacción -- no la había, pese a que el SDK de Gemini (`@google/genai`)
  expone esa metadata en cada respuesta real. Se decidió persistir en Postgres (no solo loguear)
  porque el pedido explícito fue poder auditar "por conversación" y "por mes" de forma confiable,
  algo que grep sobre logs de stdout no garantiza a mediano plazo. Se usa el patrón fail-safe
  (igual que `obtenerHistorialSeguro`/`guardarMensajeSeguro` de 5.1) y NO el patrón fail-loud de
  `confirmador`/`enviarMensaje` (5.14) porque esto es observabilidad de costo, no una garantía de
  seguridad/corrección -- un fallo al registrar tokens nunca debe degradar la respuesta al usuario.
  Se aprovechó la misma investigación para revisar cuánto historial de conversación se reenvía al
  prompt (pregunta separada del mismo usuario): `historyStore.ts` ya limita a los últimos 20
  mensajes con TTL de 24h, y solo persiste el texto final de cada turno (nunca las tool calls
  intermedias) -- no se encontró ningún problema ahí, no se hizo ningún cambio sobre eso.
- **Made by:** dev (pedido explícito del usuario en el chat de esta sesión)

---

### 2026-09-13 — Bug de producción corregido: Gemini rechazaba la segunda ronda de tool-calling por falta de `thoughtSignature`
- **Decision:** `messageOrchestrator.agregarResultadoTool` ahora reutiliza el `Content` REAL
  devuelto por Gemini (`respuesta.candidates[0].content`) al reenviar el historial en la
  siguiente ronda del ciclo, en vez de reconstruir el `Part` del `functionCall` a mano a partir
  de `nombreTool`/`argumentos`. Fallback defensivo (con warning en logs) si por algún motivo
  `candidates[0].content` no viene en la respuesta.
- **Rationale:** en producción, tras resolver la asociación del PAT de un usuario, el primer
  pedido real con tool calling (`get_transactions`) falló con `400 INVALID_ARGUMENT`: "Function
  call is missing a thought_signature in functionCall parts". El modelo detrás de
  `gemini-flash-latest` usa "thinking" y exige que el `thoughtSignature` opaco que devuelve en el
  `Part` de cada `functionCall` se le reenvíe intacto en la siguiente llamada del mismo ciclo
  multi-turno; `agregarResultadoTool` (escrito en 5.1, nunca tocado desde entonces) descartaba
  ese campo al reconstruir el `Content` del rol `"model"` a mano. No es un gap de planning (no
  hay una historia sin cubrir) sino un defecto real dentro del alcance ya cerrado de 5.1/5.14 --
  se corrige directo, sin abrir una historia nueva, y se documenta acá para que quede rastreado.
  2 tests nuevos en `messageOrchestrator.test.ts` (preserva `thoughtSignature`; fallback
  defensivo sin `candidates`).
- **Made by:** dev (bug reportado en logs de producción por el usuario)

---

### 2026-09-13 — Segundo gap de planning: la confirmación de acciones irreversibles (4.3) tampoco estaba cableada. Nueva historia 5.14 agregada
- **Decision:** se agrega la historia `5.14.confirmar-acciones-irreversibles` a Épica 5, en
  `ready-for-dev` de inmediato (dependencias -- 4.3, 5.13 -- ya `done`), y se implementa en la
  misma sesión en que se la detecta, a pedido explícito del usuario tras presentarle el riesgo.
- **Rationale:** al cerrar 5.13 (que hace alcanzable en producción el ciclo
  `messageOrchestrator` → `mcpToolExecutor.ejecutarTool`), se verificó si el mecanismo de
  confirmación explícita para acciones irreversibles (historia 4.3:
  `toolClassification.clasificarToolCall` + `confirmacionAccionIrreversible.solicitarConfirmacion`,
  ambos construidos y probados desde 4.3) estaba conectado a ese ciclo. No lo estaba, y una
  búsqueda explícita en todo el backlog (`grep` de `solicitarConfirmacion`/`clasificarToolCall`
  en `bmad-output/stories/*.story.md`) confirmó que ninguna historia (ni 5.1 ni 5.4, la
  candidata más obvia por tocar `messageOrchestrator.ts`) tiene ese cableado en su alcance. Se
  presentó el riesgo al usuario (Gemini podía ejecutar cualquiera de las 140 tools, incluidas
  las 16 `delete_*`, sin pedir confirmación) vía `AskUserQuestion`; el usuario eligió resolverlo
  de inmediato antes de continuar con cualquier otra historia.
- **Made by:** dev (detección ad-hoc, mismo criterio que la entrada anterior de 5.13)
- **Supersedes:** ninguna.

---

### 2026-09-13 — Gap de planning encontrado y corregido: ninguna historia cableaba el orquestador de Gemini al webhook real. Nueva historia 5.13 agregada
- **Decision:** se agrega la historia `5.13.integrar-orquestador-webhook` ("Cablear el orquestador
  de Gemini al webhook real de Telegram") a Épica 5, en `ready-for-dev` de inmediato (sus
  dependencias -- 5.1, 1.5 -- ya están `done`), y se implementa/cierra en la misma sesión que se
  la detecta.
- **Rationale:** el usuario reportó en producción que el bot le respondió con un eco literal a
  una pregunta en lenguaje natural ("¿cuánto llevo gastado este mes?"), pese a que las historias
  5.1/5.2/5.3 ya estaban `done`. Investigando: ninguna historia de Épica 5 (5.1-5.5) tiene en su
  Owned File/Module Scope `src/webhook/telegramWebhook.ts` -- 5.1 documentó explícitamente en su
  propio cierre "ningún handler de Telegram llama a `messageOrchestrator.procesarMensaje`... lista
  para que 5.2+ la conecte", pero 5.2 y 5.3 excluyeron deliberadamente `messageOrchestrator.ts` de
  su alcance (correctamente, según sus propias historias), y 5.4 (el candidato más probable, ya
  que sí toca `messageOrchestrator.ts`) solo agrega ahí una rama de manejo de error de validación
  -- sus Acceptance Criteria (LOCKED) no piden en ningún punto reemplazar `echoHandler.ts` en el
  webhook real. Es decir: la tarea de "conectar el pipeline construido al bot real" quedó fuera
  del alcance declarado de las 5 historias de la épica, un hueco genuino de secuenciación, no una
  historia que alguien decidió posponer a propósito. Se agrega como historia nueva en vez de
  ampliar el alcance de 5.4 (evita tocar una historia con Acceptance Criteria LOCKED sin pasar por
  una actualización explícita de planning) y se cierra de inmediato porque es la que resuelve el
  problema real reportado por el usuario, con prioridad sobre continuar 5.4 tal cual estaba
  planeada.
- **Made by:** dev (detección ad-hoc durante la sesión, sin invocar explícitamente
  bmad-correct-course; documentado acá para que quede trazable igual que un course-correction
  formal)
- **Supersedes:** ninguna -- complementa (no contradice) el cierre de 5.1/5.2/5.3/4.4.

---

### 2026-09-13 — Historia 4.1: candidato de MCP descartado y reemplazado tras verificación empírica
- **Decision:** el candidato de MCP originalmente asumido para la historia 4.1
  (`@firefly-iii-mcp/server`, v1.4.0) se descartó tras confirmar en la VPS —
  con headers `Authorization`/`X-Firefly-III-Url` inválidos — que devolvía
  igual una cuenta real de producción: el paquete ignora por completo las
  credenciales por-request pese a documentarlas en su README, y usa siempre
  el PAT/URL fijo del arranque. Se reemplazó por `daften/fireflyiii-mcp`
  (`ghcr.io/daften/fireflyiii-mcp:0.4.6`), verificado esta vez leyendo el
  código fuente (`http.ts`/`client.ts`/`index.ts`) antes de tocar infra: el
  token sí se resuelve por request vía `AsyncLocalStorage`, y además cubre
  140 tools en 14 grupos contra ~41 del descartado.
- **Rationale:** el AC #1 de la historia 4.1 exige detenerse si el candidato
  no soporta credenciales por-request — no desplegar un MCP mono-tenant.
  Confiar solo en documentación pública (README, resúmenes de terceros)
  resultó insuficiente: el primer candidato documentaba un comportamiento
  que su código no implementaba. Lección para toda evaluación futura de un
  componente de terceros con implicancias de seguridad/aislamiento: verificar
  contra el código fuente y, cuando sea barato hacerlo, con una prueba
  empírica (headers inválidos que deberían fallar si el mecanismo funciona
  como se espera) antes de construir infra alrededor.
- **Impact:** `infra/docker-compose.yml` (servicio `mcp-firefly` reemplazado
  de `build:` propio a `image:` oficial), `mcp/Dockerfile` eliminado,
  `mcp/README.md` reescrito, `bmad-output/stories/4.1.mcp-multitenant-deploy.story.md`
  Dev Agent Record documenta ambas verificaciones. `sprint-status.yaml`: 4.1
  vuelve a `in-progress` (pasó brevemente por `backlog` mientras estuvo
  bloqueada). 4.2/4.3 (dependientes de 4.1) sin cambios de estado — seguían
  bloqueadas transitivamente durante el intervalo y ahora depende de que 4.1
  cierre con la verificación manual pendiente en producción.
- **In-progress stories affected:** 4.1 (mcp-multitenant-deploy).
- **Made by:** dev tool externo (esta sesión), documentado aquí porque es una
  decisión de arquitectura/candidato tecnológico, no solo una corrección de
  código dentro del scope ya definido de la historia.
- **Supersedes:** ninguna entrada previa — primera vez que se evalúa un
  candidato de MCP concreto para Epic 4.

### 2026-09-13 — Resecuenciado tras corrección de rumbo (bmad-sprint-planning)
- **Decision:** recalculado el grafo de dependencias completo de `sprint-status.yaml` tras la
  corrección de rumbo (entrada anterior). Las 14 historias nuevas quedaron asignadas a waves ya
  existentes (Epic 10 → wave 8; 4.4 → wave 11; 5.6-5.12 → wave 12) — el total se mantiene en 16
  waves, 49 historias, sin inversiones de dependencia. Ninguna historia existente cambió de wave.
- **Rationale:** se detectaron dos conflictos de `owned_scope` dentro de la misma wave: 4.4 vs 4.3
  comparten `mcp/README.md` (resuelto subiendo 4.4 a wave 11, sin costo aguas abajo porque 5.1 ya
  dominaba esa rama); 5.6-5.12 entre sí y con 5.2, y 10.1-10.6 entre sí, comparten
  `promptBuilder.ts`/`telegramWebhook.ts` respectivamente dentro de la misma wave — se documentó el
  conflicto en vez de fragmentar en waves individuales, dado que el proyecto se viene desarrollando
  una historia a la vez (no hay despacho paralelo real todavía que lo vuelva un problema práctico).
- **Impact:** `sprint-status.yaml` actualizado (`parallel_set` de las 14 historias nuevas,
  `wave_widths` recalculado). `ready_for_dev` sin cambios (0.4, 3.2, 6.1, 7.1, 8.3, 8.4, 8.5).
- **In-progress stories affected:** ninguna.
- **Made by:** bmad-sprint-planning (routeado desde bmad-correct-course)
- **Supersedes:** ninguna — complementa la entrada anterior de la misma corrección de rumbo.

### 2026-09-13 — Course Correction: cobertura completa de Firefly III vía chat, sin excepciones
- **Decision:** el usuario pidió explícitamente que **ninguna** función de Firefly III quede
  fuera del alcance manejable desde el chat de Telegram ("no quiero dejar nada afuera"),
  incluyendo funciones que el backlog original no contemplaba: transacciones avanzadas
  (ingreso, transferencia, split, reconciliación), cuentas de activo y pasivos/deudas,
  categorías/tags/grupos de objetos, presupuestos/auto-budget/piggy banks, automatización
  (bills, recurrencias, reglas), multi-moneda, reportes/búsqueda/insights, y funciones de
  cuenta/sistema (preferencias, PAT propios, 2FA, webhooks, import/export de datos).
  Se confirmó también que, para acciones irreversibles, una **confirmación explícita del
  usuario en el chat alcanza** como control de seguridad — no hace falta bloquearlas del
  todo a nivel de protocolo.
- **Rationale:** el bot ya está arquitecturado alrededor de un servidor MCP (Epic 4) que Gemini
  (Epic 5) invoca como "tools" — esto significa que ampliar cobertura no es, en general, escribir
  decenas de comandos rígidos nuevos, sino (a) no restringir qué tools expone el MCP y (b) que
  el prompt de Gemini sepa pedir cualquiera de ellas. Se evaluó mantener el MVP original acotado
  a gasto/resumen y expandir después según uso real (alternativa descartada por decisión
  explícita del usuario, quien prefiere planificar la cobertura completa ahora).
- **Impact:**
  - **Epics modificados:** Epic 4 (Servidor MCP) — alcance cambia de "restringir tools" a
    "exponer todo el catálogo con confirmación para irreversibles"; Epic 5 (Gemini) — alcance
    se amplía de "gasto/consulta" a los 7 grupos financieros completos.
  - **Epic nuevo:** Epic 10 "Cuenta y sistema vía chat" — cubre las funciones que no encajan
    como tools de IA conversacional (2FA, preferencias, PAT propios, webhooks, import/export).
  - **Historia re-escrita (LOCKED sections, con autorización explícita del usuario):** 4.3
    `mcp-tools-restringidas` — de "limitar/bloquear tools destructivas" a "confirmación
    explícita para acciones irreversibles". Slug/nombre de archivo sin cambios para no romper
    referencias cruzadas; título y contenido completamente re-escritos.
  - **Historias agregadas (14, todas compiladas como objetos de contexto completos, status
    `backlog`):** 4.4 `auditoria-cobertura-tools-mcp` (spike, análogo a 1.2); 5.6
    `transacciones-avanzadas-nl`; 5.7 `cuentas-pasivos-nl`; 5.8 `organizacion-nl`; 5.9
    `presupuestos-ahorro-nl`; 5.10 `automatizacion-nl`; 5.11 `multi-moneda-nl`; 5.12
    `reportes-insights-nl`; 10.1 `preferencias-via-chat`; 10.2 `gestion-pat-propio-chat`; 10.3
    `activar-2fa-chat`; 10.4 `webhooks-firefly-notificaciones`; 10.5 `exportar-datos-chat`; 10.6
    `importar-datos-chat`.
  - **`sprint-status.yaml`:** epic-10 agregado con sus 6 historias; las 14 historias nuevas
    agregadas a `stories:` con dependencias resueltas y `parallel_set: 0` como placeholder
    (pendiente de recálculo real vía `bmad-sprint-planning`); `total_stories` actualizado a 49;
    `total_waves`/`wave_widths` marcados como stale hasta el recálculo.
  - **Ninguna historia existente fue cancelada** — la corrección solo amplía alcance, no recorta
    nada del backlog original.
- **In-progress stories affected:** ninguna — Epic 1-3 y 8.1 ya están `done`/cerradas y no las
  toca esta corrección; ninguna historia estaba `in-progress` en el momento de aplicarla.
- **Made by:** bmad-correct-course
- **Supersedes:** ninguna entrada previa — primera corrección de rumbo del proyecto.

### 2026-09-13 — Historia 3.1 (comando /gasto) cerrada — verificada en producción
- **Decision:** el administrador configuró `FIREFLY_PAT`/`FIREFLY_BASE_URL`/`FIREFLY_SOURCE_ACCOUNT`
  en la VPS y confirmó que `/gasto 20000 almuerzo` crea la transacción real en Firefly III.
- **Incidente de despliegue (2 rondas) documentado como aprendizaje permanente:** (1) el primer
  intento post-`git pull` + `pm2 restart` sin `npm run build` dejó corriendo el `dist/` compilado
  viejo — el bot seguía respondiendo el eco en vez de procesar `/gasto`, porque pm2 ejecuta
  `dist/index.js`, no el código fuente. (2) el segundo intento, ya con `npm run build`, no tenía
  las tres variables de entorno nuevas configuradas — el proceso no arrancó en absoluto (`env.ts`
  falla rápido ante configuración incompleta, comportamiento esperado pero que se manifestó como
  "el bot no responde nada"). Ambos se agregaron al README como nota operativa permanente para el
  flujo de despliegue de cualquier cambio futuro que toque `src/`.
- **Housekeeping:** `3.2.comando-resumen-mensual` (ya redactada como `ready-for-dev` en su propio
  archivo) se libera ahora que `3.1` — su única dependencia, ya que comparten `firefly-client.ts`
  — está `done`. Se agrega a `ready_for_dev` en `sprint-status.yaml`.
- **Made by:** dev agent (implementación de 3.1)
- **Supersedes:** la entrada anterior de 3.1 (implementada, verificación pendiente) — ahora `done`.

### 2026-09-13 — Historia 3.1 (comando /gasto): implementada, pendiente de verificación manual
- **Decision:** primer camino real Telegram → Firefly III sin IA (Epic 3). `firefly-client.ts`
  (`createFireflyClient`) envuelve `POST /api/v1/transactions` (`type: withdrawal`,
  `source_name`/`destination_name`, timeout de 8s como circuit breaker simple) usando el **PAT
  propio del desarrollador** por variable de entorno (`FIREFLY_PAT`/`FIREFLY_BASE_URL`), sin
  resolución por-usuario todavía (eso es Epic 4, conectando 1.5). `gasto.ts` parsea/valida
  `/gasto <monto> <concepto>` y se registra en `telegramWebhook.ts` ANTES del echo (historia 2.2)
  para que un `/gasto` no dispare también el eco.
- **Desviación de alcance:** se agregó `FIREFLY_SOURCE_ACCOUNT` (no mencionada por la historia) —
  Firefly III exige una cuenta de activo como origen de cualquier `withdrawal`; sin ella AC #1 es
  imposible de cumplir contra la API real.
- **Adaptación de nombres:** la historia menciona `bot-service/src/bot.ts` como router de comandos;
  ese archivo no existe — el router real de Epic 2 es
  `webhook/telegramWebhook.ts::createTelegramWebhookHandler`, que ahora recibe `fireflyClient` como
  parámetro adicional (junto con `server.ts` e `index.ts`). Mismo patrón de adaptación ya usado en
  1.1/1.3.
- **Manejo de errores:** cualquier fallo de Firefly (401/422/timeout/caído) colapsa a un mensaje
  genérico para el usuario y se loggea solo `{chat_id, err}` (nunca el PAT ni el status técnico al
  usuario) — mismo criterio fail-safe de `credential-resolver.ts` (1.5).
- **Testing:** 103 tests pasan (17 nuevos: `firefly-client.test.ts` con `fetch` mockeado,
  `gasto.test.ts` con `bot.handleUpdate` real de grammY). `tsc --noEmit` limpio. La propia DoD de
  la historia exige verificación manual del camino feliz + un caso de error contra Firefly III
  real — no se puede hacer desde acá sin el PAT real del desarrollador (nunca se comparte en el
  chat), queda pendiente del administrador en la VPS.
- **Made by:** dev agent (implementación de 3.1)

### 2026-09-13 — Historia 1.5 (PAT por-request en el MCP) cerrada — Epic 1 completo
- **Decision:** implementado `bot-service/src/auth/credential-resolver.ts`:
  `createCredentialResolver({ usuariosRepository, fireflyUrl })` retorna `getUserCredentials(chatId)`,
  que resuelve/descifra el PAT (vía 1.4) en cada invocación, sin cachear nada entre llamadas (AC #3),
  y devuelve `{ pat, fireflyUrl }` listo para `Authorization: Bearer <pat>` (AC #2). Cualquier fallo
  al resolver (sin PAT, PAT corrupto, o error de infraestructura) se loggea (`chat_id` + `err`, nunca
  el PAT) y colapsa uniformemente a `CredencialesNoDisponiblesError` **antes** de que el llamador
  pueda invocar una tool del MCP — nunca hace fallback a un PAT compartido o de otro usuario (AC #4).
- **Alcance:** no se integró ningún pipeline real (Epic 4/5 todavía no existen en el repo) ni se tocó
  `index.ts`/`env.ts` — la propia historia lo marca explícitamente fuera de su alcance ("la
  integración end-to-end contra un MCP real ocurre en Epic 4"). El mecanismo se construyó y probó
  aislado, con el cliente MCP simulado en los tests, tal como pide la estrategia de testing de la
  historia.
- **Sin verificación en producción:** a diferencia de 1.1/1.3/1.4, esta historia no toca
  infraestructura, variables de entorno ni tablas, y no la consume ningún código real todavía — se
  cerró en base a la cobertura completa de tests (12 nuevos: 7 unitarios + 5 de concurrencia
  simulada con `Promise.all`, incluyendo 20 `chat_id` simultáneos) en vez del ciclo habitual de
  despliegue + confirmación del administrador.
- **Housekeeping (impacto grande):** al quedar Epic 1 completo (1.1-1.5 done), se liberaron 7
  historias en simultáneo cuyas dependencias ya estaban satisfechas: `0.4.backups-automaticos`,
  `3.1.comando-gasto-manual`, `6.1.webhook-dedup-update-id`, `7.1.waterfly-conexion-pat`,
  `8.3.rotacion-secretos`, `8.4.alertas-caida-servicio`, `8.5.prueba-carga-50-usuarios`. Las 7 ya
  estaban redactadas como `ready-for-dev` en su propio archivo `.story.md` pero figuraban `backlog`
  en `sprint-status.yaml` — mismo patrón de inconsistencia visto repetidamente con 1.1/1.3/1.4,
  corregido para las 7 de una vez. `sprint-status.yaml` ahora lista las 7 en `ready_for_dev`; queda
  a criterio del usuario cuál elegir primero.
- **Made by:** dev agent (implementación de 1.5)

### 2026-09-12 — Historia 1.4 (PAT cifrado en Postgres) cerrada — verificada en producción
- **Decision:** el administrador aplicó la migración `0002` y configuró `PAT_ENCRYPTION_KEY` en la
  VPS, reinició el Bot Service y confirmó que el flujo `crear` → `completar-pat` cifra (AES-256-GCM)
  y persiste el PAT correctamente contra la instancia real de Firefly III/Postgres.
- **Housekeeping:** `1.5.pat-por-request-mcp` ya estaba redactada como `ready-for-dev` en su propio
  archivo (su única dependencia, 1.4, ahora está `done`) — queda como único `ready-for-dev` en
  `sprint-status.yaml`.
- **Made by:** dev agent (implementación de 1.4)
- **Supersedes:** la entrada anterior de 1.4 (implementada, despliegue pendiente) — ahora `done`.

### 2026-09-12 — Historia 1.4 (PAT cifrado en Postgres): implementada, pendiente de despliegue
- **Decision:** cifrado AES-256-GCM (`node:crypto` nativo, sin dependencias nuevas) para el PAT en
  reposo. `src/auth/pat-crypto.ts` expone funciones puras `cifrarPat`/`descifrarPat`/
  `decodificarClaveCifrado` (reciben la clave como `Buffer`, no leen `env`, quedan testeables de
  forma aislada). El valor se guarda en la columna nueva `pat_cifrado` (migración `0002`, no toca
  la de 1.1) con formato `"<iv-b64>.<authTag-b64>.<ciphertext-b64>"` — un solo campo cubre los
  metadatos que exige GCM sin sumar columnas. `usuarios.repository.ts` (de 1.1) se extendió con
  `guardarPatCifrado(chatId, pat)` y `obtenerPatDescifrado(chatId)`; `createUsuariosRepository`
  ahora recibe la clave de cifrado como segundo parámetro explícito (mismo patrón que
  `createFireflyAdminClient` de 1.3: config explícita, no lectura oculta de `env`).
- **AC #4 (arranque):** `config/env.ts` agrega `patEncryptionKey`, decodificado y validado (32
  bytes) por `decodificarClaveCifrado` al construir `env` — el proceso falla al importar el módulo
  si `PAT_ENCRYPTION_KEY` falta o tiene el largo incorrecto, igual que los demás campos
  `required()` ya existentes.
- **Desviación de alcance documentada:** `scripts/alta-usuario.ts` (creado en 1.3, fuera del Owned
  File/Module Scope de 1.4) tenía un sink placeholder explícito para el paso `completar-pat`,
  pensado para ser reemplazado una vez que existiera esta historia. Se reemplazó por un sink real
  que llama a `guardarPatCifrado`, cerrando el flujo de alta 1.3+1.4 de punta a punta — sin este
  cambio el AC #2 no tendría forma de ejercitarse en producción.
- **Auditoría de logging (AC #5):** revisados los puntos de logging de 1.1/1.3 — ninguno serializa
  el objeto `usuario` completo ni loggea `pat_cifrado`; `findByChatId` ni siquiera selecciona esa
  columna. `obtenerPatDescifrado` (el único método que devuelve el PAT en texto plano) todavía no
  tiene caller en el código — queda para 1.5, que deberá mantener esa misma disciplina.
- **Testing:** 67 tests pasan localmente (19 nuevos: `pat-crypto.test.ts` unitario puro,
  `usuarios.repository.pat.test.ts` con mocks + 3 de integración con Postgres real vía contenedor
  efímero, saltadas en este entorno por falta de Docker — mismo patrón que la integración de 1.1).
  `tsc --noEmit` limpio.
- **Made by:** dev agent (implementación de 1.4)
- **Pendiente:** el administrador debe aplicar la migración `0002` y configurar
  `PAT_ENCRYPTION_KEY` en la VPS antes de cerrar la historia.

### 2026-09-12 — Historia 1.3 (alta de usuario Firefly III) cerrada — verificada en producción
- **Decision:** usuario corrió ambos comandos contra la VPS real. `crear` (con un `chat_id` de
  prueba `999000001`, no un chat real de Telegram porque el comando no envía nada a Telegram)
  creó la cuenta en Firefly III (`id=2`) y habilitó el `chat_id` en `usuarios_autorizados`; el
  log estructurado mostró `{administrador, chat_id, firefly_user_id}` sin PAT. `completar-pat`
  con un PAT falso confirmó que el valor nunca aparece en el log ni se persiste en ningún lado
  (placeholder hasta 1.4). Datos de prueba limpiados después (fila borrada, cuenta Firefly de
  prueba borrada a mano).
- **Housekeeping:** `sprint-status.yaml` tenía `1.4.pat-cifrado-postgres` como `backlog` pese a
  que su propio archivo ya la redacta como `ready-for-dev` — mismo patrón de inconsistencia visto
  con 1.1 y 1.3 anteriormente. Corregido: 1.4 queda como único `ready-for-dev` (sus dependencias
  1.1 y 1.3 ya están `done`).
- **Made by:** dev agent (implementación de 1.3)
- **Supersedes:** la entrada anterior de 1.3 (código completo, despliegue pendiente) — ahora `done`.

### 2026-09-12 — Historia 1.3 (alta de usuario Firefly III): implementada, pendiente de despliegue
- **Decision:** implementada la variante **semi-manual** confirmada por el spike 1.2 (Firefly III
  no puede generar un PAT en nombre de otro usuario vía API admin). `firefly-admin-client.ts`
  envuelve `POST /api/v1/users` sin enviar `role` (el usuario nuevo no hereda privilegios owner).
  `alta-usuario.ts` orquesta: crea la cuenta en Firefly → solo si tuvo éxito registra el `chat_id`
  en `usuarios_autorizados` con `activo=true` (reutilizando el repositorio de 1.1, al que se le
  agregó el método `crear()`) → devuelve instrucciones para que el usuario genere su propio PAT
  en `/profile`. El PAT que el admin recibe después se entrega a un `PatSink` inyectado
  (`entregarPatUsuario`) que nunca lo persiste ni lo loggea — hasta que exista 1.4 (cifrado +
  persistencia), el sink real es un placeholder que solo avisa y descarta el valor en memoria.
- **Desviación de scope:** se agregó `bot-service/scripts/alta-usuario.ts` (CLI de dos
  subcomandos), no listado en el Owned File/Module Scope original de la historia — sin un punto
  de entrada ejecutable, el AC #1 ("cuando el administrador ejecuta el flujo de alta") no tenía
  forma de correr. Mismo criterio que `scripts/migrate.ts` en la historia 1.1.
- **Decisión de diseño:** alta con `chat_id` duplicado **falla explícitamente** (no es
  idempotente) — un duplicado casi siempre es un error del administrador, y fallar rápido evita
  crear una segunda cuenta Firefly innecesaria.
- **Riesgo aceptado, no mitigado:** si Firefly tiene éxito pero el registro en la whitelist falla
  justo después (ej. Postgres caído en ese instante), queda una cuenta huérfana en Firefly sin
  `chat_id` asociado. A la escala de esta historia (alta manual, ~10-50 usuarios) se repara a
  mano vía el log de auditoría — no se construyó un rollback/saga automático.
- **No se construyó integración en vivo contra Firefly III real:** la única instancia es la de
  producción (`firefly.nyoholding.com`); crear un test automatizado que dé de alta usuarios
  reales contra ella en cada corrida de CI es un riesgo mayor que su valor a esta escala. Se
  cubre con tests unitarios exhaustivos (cliente HTTP con `fetch` mockeado + orquestador con
  dependencias mockeadas) — la verificación real queda para cuando el administrador corra el
  script contra la VPS.
- **Verificación local:** `npm test` → 51 passed, 2 skipped (los 2 skipped son la suite de
  integración Postgres de 1.1, sin relación); `npx tsc --noEmit` sin errores.
- **Made by:** dev agent (implementación de 1.3)
- **Supersedes:** none

### 2026-09-12 — Historia 1.1 (whitelist de chat_id) cerrada — verificada en producción
- **Decision:** usuario desplegó (migración aplicada, `chat_id` propio dado de alta, `pm2 restart`) y confirmó ambos casos en vivo: un `chat_id` no dado de alta recibe "No autorizado..."; el `chat_id` propio sigue recibiendo el eco normal (probado con "hla").
- **Nota operativa:** la VPS no tiene `psql` instalado en el host — hubo que correrlo vía `docker exec -it bot-postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "..."'`. Documentado en `bot-service/README.md` para la próxima vez que haga falta un `INSERT`/consulta manual contra ese Postgres.
- **Housekeeping:** se corrigió otra inconsistencia igual a la de 1.1 con la historia `1.3.alta-usuario-firefly` — su propio archivo ya la tenía como `ready-for-dev` pero `sprint-status.yaml` la marcaba `backlog`. Sus dos dependencias (1.1, 1.2) ya están `done`, así que queda como único item `ready-for-dev`.
- **Made by:** dev agent (implementación de 1.1)
- **Supersedes:** la entrada anterior de 1.1 (código completo, despliegue pendiente) — ahora `done`.

### 2026-09-12 — Historia 1.1 (whitelist de chat_id): implementada, pendiente de despliegue
- **Decision:** whitelist implementada como middleware nativo de grammY (`bot.use(createWhitelistMiddleware(bot, repo))`), registrado antes que cualquier handler de negocio en `telegramWebhook.ts` — grammY ya corta la cadena de middlewares si no se llama `next()`, así que AC #2/#3/#4 salen del propio framework en vez de un pipeline propio a medida. Tabla `usuarios_autorizados` (Postgres de la 0.3) vía migración idempotente (`CREATE TABLE IF NOT EXISTS`) + `npm run migrate` nuevo (no estaba en el Owned Scope original, pero evita aplicar SQL a mano en cada deploy — mismo criterio que `npm run set-webhook`).
- **Bug encontrado y corregido en desarrollo:** la versión inicial usaba `ctx.reply(...)` para el mensaje de "no autorizado" y los tests fallaban con `401 Unauthorized` real contra la API de Telegram — grammY crea una instancia de `Api` nueva por cada update dentro de `handleUpdate` (no reutiliza `bot.api`), así que mockear `bot.api.sendMessage` no interceptaba `ctx.reply`. Se corrigió reutilizando `sendTelegramMessage(bot, chatId, texto)`, el mismo wrapper que `echoHandler.ts` ya usa desde la historia 2.2 por este exact motivo.
- **Fail closed:** si la consulta a Postgres lanza una excepción, el middleware niega el acceso (no llama a `next()`) en vez de dejarlo pasar — el Dev Notes de la historia lo pedía explícitamente dado que el aislamiento entre usuarios es el NFR más crítico del proyecto.
- **Verificación:** `npm run build` limpio; `npm test` → 39/39 en verde + 2 tests de integración con un Postgres real efímero (Docker) que se saltan automáticamente en este entorno (sin daemon Docker alcanzable) pero correrán completos en la VPS. `npm audit`: `pg` no suma vulnerabilidades nuevas.
- **Made by:** dev agent (implementación de 1.1)
- **Supersedes:** none

### 2026-09-12 — Historia 0.3 (Postgres/Redis del bot) cerrada — verificada en producción
- **Decision:** usuario desplegó `bot-postgres`/`bot-redis` en la VPS y confirmó los tres AC pendientes: conectividad (`psql`/`redis-cli` responden `1`/`PONG` desde un contenedor auxiliar en `firefly-iii-net`), aislamiento (`ss -tlnp` confirma ambos puertos bindeados a `127.0.0.1`, no a `0.0.0.0`/`:::`) y persistencia (`docker compose down && up -d` sin pérdida de datos).
- **Made by:** dev agent (implementación de 0.3)
- **Supersedes:** la entrada anterior de 0.3 (código completo, despliegue pendiente) — ahora `done`. Con esto queda sin bloqueos la historia 1.1 (whitelist-chat-id).

### 2026-09-12 — Historia 0.3 (Postgres/Redis del bot) adelantada — bloqueo real detectado en 1.1
- **Decision:** al ir a implementar 1.1 (whitelist-chat-id) se detectó que depende de un Postgres dedicado al Bot Service que no existe — Firefly III usa MariaDB (historia 0.1), no hay ningún Postgres en la VPS. Se le presentó la disyuntiva al usuario (implementar 0.3 primero vs. reabrir 1.1 en planning para no requerir Postgres) y eligió resolver 0.3 primero, sin tocar los AC de 1.1. Se agregaron `bot-postgres` (postgres:16-alpine) y `bot-redis` (redis:7-alpine) a `infra/docker-compose.yml`.
- **Desviación documentada:** ambos servicios se publican en `127.0.0.1:<puerto>` (no solo en la red Docker interna, como una lectura literal del AC #5 sugeriría) porque el Bot Service corre como proceso `pm2` en el host, fuera de este compose — mismo patrón ya verificado en producción para Firefly III en la historia 0.1. Sin este ajuste, la infraestructura quedaría inalcanzable para su único consumidor real.
- **Housekeeping:** se corrigió `sprint-status.yaml`, que tenía a `1.1.whitelist-chat-id` marcada como `backlog` cuando su propio archivo de historia ya estaba completamente redactado (`ready-for-dev`) — inconsistencia entre los dos artefactos de planning, ahora alineados.
- **Verificación:** `docker compose config` (con un `.env` temporal desde `.env.example`, nunca commiteado) confirma que el YAML resuelve sin errores de sintaxis/interpolación. Sin levantar el stack — regla del proyecto: Docker/compose de Firefly (y ahora de esta historia) solo corre en la VPS remota. Falta desplegar y correr la verificación de conectividad/aislamiento de `infra/README.md` antes de cerrar a `done`.
- **Made by:** dev agent (implementación de 0.3, en el flujo de resolver 1.1)
- **Supersedes:** none

### 2026-09-12 — Historia 8.1 (logs estructurados) cerrada — verificada en producción
- **Decision:** usuario desplegó en la VPS (`git pull && npm install && npm run build && pm2 restart bot-service`) y confirmó vía `pm2 logs bot-service` que la salida es JSON estructurado real, con `update_id`/`chat_id` correlacionables — cierra el AC #5 (stdout/stderr, sin infraestructura adicional) de forma concreta, no solo por tests locales.
- **Made by:** dev agent (implementación de 8.1)
- **Supersedes:** la entrada anterior de 8.1 (código completo, despliegue pendiente) — ahora `done`.

### 2026-09-12 — Historia 8.1 (logs estructurados): implementada, pendiente de despliegue
- **Decision:** logger central con `pino` en `bot-service/src/lib/logger.ts` (ruta adaptada de la genérica `src/lib/logger.ts` del Owned File/Module Scope, que no contemplaba que el código vive bajo `bot-service/`) + `bot-service/src/config/logging.config.ts` para `LOG_LEVEL`. Reemplaza el logger mínimo de la historia 2.3 (`src/logging/logger.ts`, eliminado). Instrumentado: webhook (recibido/encolado/desencolado/procesado/error) e `index.ts` (`uncaughtException`/`unhandledRejection`). Gemini y MCP quedan explícitamente sin instrumentar porque esos módulos son de Epic 4/5 y todavía no existen en el código.
- **Rationale:** `pino` por overhead bajo (sugerencia del Dev Notes de la historia); `formatters.level` + `timestamp` custom para que el JSON tenga exactamente los nombres de campo del AC #2 (`timestamp` ISO, `level` como string); `redact.paths` de pino cubre `pat`/`token`/`apiKey`/`authorization` (AC #4) porque los call sites de logging son controlados por este código, no hace falta redacción recursiva genérica.
- **Verificación:** `npm run build` limpio; `npm test` → 29/29 en verde, cubriendo `resolveLogLevel` (niveles válidos/inválidos), el logger (JSON parseable, filtrado por nivel, redacción, serialización de errores con stack), y el webhook instrumentado (contexto `update_id`/`chat_id` en cada log, error loggeado con stack sin afectar el ack). `npm audit`: pino no suma vulnerabilidades nuevas. Falta desplegar en la VPS y confirmar con `pm2 logs bot-service` que la salida real es JSON estructurado — a diferencia de 2.1/2.2, acá la verificación de producción sí es central al valor de la historia (logs para debugging real).
- **Made by:** dev agent (implementación de 8.1)
- **Supersedes:** el logger mínimo introducido en la historia 2.3 (`src/logging/logger.ts`), que su propio Dev Agent Record ya marcaba como no siendo "la solución completa de 8.1".

### 2026-09-12 — Historia 2.3 (ack asíncrono del webhook) cerrada — Epic 2 completo
- **Decision:** usuario desplegó en la VPS (`git pull && npm install && npm run build && pm2 restart bot-service`) y confirmó que el bot sigue respondiendo con normalidad, sin regresiones. Verificación independiente adicional: `curl -X POST` al webhook sin `secret_token` tras el restart sigue devolviendo `401`. Con esto se cierra también la Epic 2 (bot de Telegram esqueleto) completa: 2.1, 2.2 y 2.3 done.
- **Made by:** dev agent (implementación de 2.3)
- **Supersedes:** la entrada anterior de 2.3 (código completo, despliegue pendiente) — ahora `done`.

### 2026-09-12 — Historia 2.3 (ack asíncrono del webhook): implementada, pendiente de despliegue
- **Decision:** el handler `createTelegramWebhookHandler` ahora responde `200 OK` inmediatamente después de `verifySecretToken` (2.1), y encola el `Update` crudo en una `InMemoryProcessingQueue<Update>` (nueva, `bot-service/src/queue/inMemoryProcessingQueue.ts`) cuyo processor es el mismo `bot.handleUpdate(update)` de antes — el eco de 2.2 y cualquier handler futuro no cambian su lógica, solo cuándo se disparan. Un `onError` de la cola loggea `update_id` + mensaje vía un logger JSON mínimo nuevo (`bot-service/src/logging/logger.ts`) sin tocar la respuesta HTTP ya enviada.
- **Rationale:** se eligió una cola in-process FIFO con un solo consumidor secuencial (en vez de `setImmediate` suelto por update) para tener orden explícito y evitar drenados concurrentes, sin introducir Redis/BullMQ (AC #5 — eso es explícitamente de la historia 6.2). El logger es deliberadamente mínimo: cubre solo el requisito de diagnóstico de esta historia (AC #4), no anticipa el logging estructurado completo de 8.1.
- **Verificación:** `npm run build` limpio; `npm test` → 14/14 (7 previos + 4 de `inMemoryProcessingQueue.test.ts` + 3 de `telegramWebhook.integration.test.ts`, estos últimos con `bot.handleUpdate` mockeado con delay para probar que el ack no espera el procesamiento — AC #1/#2/#3/#4 cubiertos). Falta desplegar en la VPS y confirmar que el bot sigue respondiendo sin regresiones antes de cerrar a `done` — a diferencia de 2.1/2.2, la estrategia de Testing de esta historia no exige una prueba manual explícita (es un cambio de timing interno, no de comportamiento observable).
- **Made by:** dev agent (implementación de 2.3)
- **Supersedes:** none

### 2026-09-12 — Historia 2.2 (echo del bot) cerrada — verificada en producción
- **Decision:** usuario desplegó el código en la VPS (`git pull && npm install && npm run build && pm2 restart bot-service`) y confirmó comportamiento real: mensaje "hola" enviado al bot por Telegram → respuesta `Recibido: "hola"`. Verificación independiente adicional: `curl -X POST` al webhook sin `secret_token` tras el restart sigue devolviendo `401` (el restart no rompió la protección de 2.1).
- **Made by:** dev agent (implementación de 2.2)
- **Supersedes:** la entrada anterior de 2.2 (código completo, prueba real pendiente) — ahora `done`.

### 2026-09-12 — Historia 2.2 (echo del bot): implementada con filtro nativo de grammY, no parseo manual
- **Decision:** implementado el eco usando `bot.on("message:text", ...)` de grammY (registrado en `telegramWebhook.ts` sobre el mismo `bot` de 2.1) en vez de parsear el `Update` crudo a mano como sugerían literalmente las Tasks/Subtasks de la historia. `src/handlers/echoHandler.ts` expone `formatEchoReply` (pura) y `registerEchoHandler`; `src/telegram/sendMessage.ts` es un envoltorio delgado sobre `bot.api.sendMessage` para poder mockearlo en tests.
- **Rationale:** el filtro nativo de grammY ya conoce la forma completa del tipo `Update` de Telegram (mensajes, stickers, fotos, `edited_message`, `channel_post`, etc.), así que delegarle el filtrado cumple el AC #3 (no romper con updates no soportados) de forma más robusta que reimplementar ese parseo a mano, con menos superficie para bugs. El Dev Notes de la historia ya dejaba explícito que el "cómo" del echo quedaba a criterio de implementación — esto es una decisión de implementación, no un cambio de alcance ni de AC.
- **Verificación:** 7/7 tests automatizados en verde (`bot.handleUpdate()` real con `bot.api.sendMessage` mockeado, no solo funciones puras aisladas) cubriendo AC #1/#2/#3 y un caso de múltiples chats. Falta la prueba manual real en producción (AC #4) — pendiente de deploy en VPS.
- **Made by:** dev agent (implementación de 2.2)
- **Supersedes:** none

### 2026-09-12 — Historia 2.1 (bot BotFather/webhook) cerrada — desplegada y verificada en VPS
- **Decision:** completado el despliegue real: bot creado en `@BotFather`, subdominio elegido `bot.firefly.nyoholding.com` (DNS A ya apuntaba a la VPS), nginx vhost + `certbot --nginx` (mismo patrón que 0.2), Bot Service corriendo con `pm2` como proceso Node directo (sin Docker, igual que `nyoholding-contact-api`), y `npm run set-webhook` corrido con éxito.
- **Verificación independiente (no solo el reporte del usuario):** `curl` desde fuera de la VPS confirmó: `http://bot.firefly.nyoholding.com` → `301` a `https://`; `https://` con TLS válido (sin `-k`) y `X-Powered-By: Express` en el 404 de `/` (confirma que el proxy llega al Bot Service real); `POST /webhook/telegram` sin el header `X-Telegram-Bot-Api-Secret-Token` → `401`; con header incorrecto → `401`. `git grep`/`git log -p` sobre `.env` confirmó que el token real nunca se commiteó.
- **Made by:** dev agent (implementación de 2.1)
- **Supersedes:** la entrada anterior de 2.1 (código completo, despliegue pendiente) — ahora sí `done`.

### 2026-09-11 — Historia 2.1 (bot BotFather/webhook): código completo, despliegue pendiente
- **Decision:** implementado el Bot Service (`bot-service/`) en Node.js + TypeScript con **grammY** (elegido sobre Telegraf por API más simple para el caso de uso y tipado nativo). Estructura: `src/server.ts` (Express + grammY Bot), `src/webhook/verifySecretToken.ts` (middleware AC #4, con test unitario), `src/webhook/telegramWebhook.ts` (handler que delega a `bot.handleUpdate`), `src/config/env.ts` (validación de env vars requeridas), `scripts/set-webhook.ts` (registra el webhook y verifica `getWebhookInfo` para el AC #5). `npm install`/`build`/`test` corridos localmente en Windows (no requiere el Docker remoto, es código Node puro) — build limpio, 3/3 tests en verde.
- **Bug encontrado y corregido antes de avanzar:** `bot.handleUpdate()` de grammY exige `bot.init()` primero; sin eso cada update real habría fallado en runtime ("Bot not initialized!"), enmascarado como un 200 silencioso por el manejo de errores del handler — el bot nunca habría procesado nada sin que se notara. `createServer()` se hizo async y ahora hace `await bot.init()` antes de exponer las rutas. Verificado con un smoke test end-to-end inyectando `botInfo` para no depender de un token real.
- **Decisión de infraestructura:** el Bot Service **no se dockeriza** en esta historia — corre como proceso Node directo (pm2), siguiendo el mismo patrón que `nyoholding-contact-api` ya usa en la VPS (proceso Node en `127.0.0.1`, expuesto por el nginx del sistema operativo). Necesita su propio subdominio (sugerido `bot.nyoholding.com`, a confirmar) con nginx vhost + certbot — mismo patrón que Firefly III en 0.2.
- **Estado:** `in-progress`, no `done` — los AC #1, #3 y #5 dependen de crear el bot real en `@BotFather` y desplegar en la VPS (DNS, nginx, certbot, correr `set-webhook`), que son pasos que solo el usuario puede ejecutar. El código y su verificación local (AC #2 y #4) ya están completos.
- **Made by:** dev agent (implementación de 2.1)
- **Supersedes:** none

### 2026-09-11 — Historia 1.2 (spike PAT) cerrada por evidencia de código fuente, sin prueba en vivo
- **Decision:** resolvió la historia 1.2 auditando directamente el código fuente oficial de Firefly III (`app/Api/V1/Controllers/System/UserController.php`, `app/Transformers/UserTransformer.php`, `routes/api.php`, `routes/web.php`, `app/Http/Controllers/Profile/OAuthController.php`) en vez de ejecutar la prueba en vivo prevista en el AC #1 contra `firefly.nyoholding.com`. Conclusión: `POST /api/v1/users` nunca devuelve un PAT y no existe ningún endpoint admin para generarlo en nombre de otro usuario — el único camino es que el propio usuario lo genere desde `/profile` con sesión web (`storePersonalAccessToken()` usa `$request->user()`, sin parámetro de impersonación). Aplica la variante **(b) semi-manual** de `system-design-v2-multiusuario.md §5` para el diseño de la historia 1.3. Documentado en `docs/plan/spike-provisionamiento-pat-findings.md`.
- **Rationale:** la prueba en vivo habría requerido pegar el PAT owner de la instancia real en el chat, algo ya descartado por seguridad en esta sesión (decisión de la historia 0.1). El AC #1 contempla explícitamente esta alternativa ("cita textual de la documentación oficial ... si la prueba en vivo no es posible"), y la evidencia de código fuente es más fuerte que un único request de prueba porque describe el comportamiento determinista de cualquier instancia corriendo ese código, no depende de configuración particular del servidor.
- **Made by:** dev agent (implementación de 1.2), no un skill de planning
- **Supersedes:** none

### 2026-09-11 — sprint-status.yaml created: 35 stories sequenced into 16 waves
- **Decision:** built `bmad-output/sprint-status.yaml`, deriving each story's `dependencies[]` from its Dependency Maps section (cross-epic links from `epics.md` + the more specific story-to-story links written during sharding), then computed `parallel_set` (wave) via topological sort (longest path from a dependency-free source). Result: 16 waves. Wave 1 = `0.1.firefly-docker-compose` only (the sole story with zero dependencies) — set to `ready-for-dev`; all other 34 stay `status: backlog` in this file (their own story files remain `ready-for-dev` as planning artifacts — this file's status reflects sequencing eligibility, not planning completeness, per the skill's status-lifecycle note "a view, not a metric").
- **Owned-scope conflict check:** verified programmatically that no two stories in the same wave share a path in `owned_scope`. Clean — no wave re-slicing was needed.
- **Known limitation surfaced:** the packaged `${bmad-sprint-planning}/scripts/sequence-stories.sh` throws `invalid variable name` and crashes on this project's story IDs (`{epic}.{story}.{slug}`, e.g. `0.1.firefly-docker-compose`) — the exact ID format shown in the script's own template example (`2.1.stripe-integration`). Root cause: the script builds bash variable names like `visiting_$id` via `declare -g`, and bash identifiers cannot contain `.` or `-`. Computed the topological sort directly instead (same wave-assignment rule: wave 1 = no deps, wave N = deps fully in waves 1..N-1). Worth reporting upstream to the skill's maintainer.
- **Rationale:** with 35 stories, 9 epics, and heavy shared-file contention (`infra/docker-compose.yml`, `bot-service/src/config/env.ts`, etc. — each touched by many stories), a solo developer benefits more from a correct sequential/wave-safe build order than from theoretical parallel dispatch; most waves have 1-4 stories since the project is naturally sequential (single dev, incrementally-built shared files).
- **Made by:** bmad-sprint-planning
- **Supersedes:** none

### 2026-09-11 — Epic map + 35 stories compiled, marked ready-for-dev
- **Decision:** sharded `docs/plan/backlog-scrum-completo.md` + `docs/plan/system-design-v2-multiusuario.md`/`system-design-asistente-gastos.md` into `bmad-output/epics.md` (10 epics) and compiled 35 story context objects (`bmad-output/stories/`) covering Epic 0-8. Epic 9 (notification capture, exploratory) was mapped but its 2 stories left uncompiled per the backlog's own explicit "not planned yet" note.
- **Rationale:** the user requested compiling all active stories. Used the skill's documented Subagent Strategy — one agent per epic, 9 agents in parallel — to keep the main session's context bounded while producing self-contained ~2-3K-token context objects per story, each with cited Dev Notes (no `prd.md`/`architecture.md` — citations point to the real `docs/plan/*.md` filenames per the earlier "adopted as-is" decision below).
- **Made by:** bmad-epics-and-stories
- **Supersedes:** none

### 2026-09-11 — Story 8.5 split (dev-day sizing rule)
- **Decision:** split the compiled "prueba de carga con 50 usuarios" story into `8.5.prueba-carga-50-usuarios` (environment + synthetic-account setup) and `8.6.ejecucion-reporte-prueba-carga` (execution + verdict report), with 8.6 Blocked-by 8.5.
- **Rationale:** the compiling subagent flagged (and I confirmed on review) that the original single story bundled tool selection, provisioning 50 synthetic accounts, scenario design, multi-service metrics instrumentation, a sustained execution, and a report with an architectural verdict — clearly exceeding the ~2-8h one-dev-day sizing rule. Split "by capability" per REFERENCE.md §2. `epics.md`'s Epic 8 story table and Delivery Tracking count updated accordingly (34 → 35 active stories).
- **Made by:** bmad-epics-and-stories
- **Supersedes:** none

### 2026-09-11 — Owned File/Module Scope path standardization
- **Decision:** reconciled inconsistent path spellings across epics for the same physical files: `docker-compose.yml` → `infra/docker-compose.yml` (in 4.1, 4.3, 6.2, 8.4, 8.6, to match the canonical path Epic 0 established); bare `.env.example` → `bot-service/.env.example` (in 1.3, 1.4, 8.1, 8.3, to match the app-level env file Epic 2/3 established, distinct from Epic 0's infra-level `infra/.env.example`); 4.1's MCP-service `.env.example` reference corrected to `infra/.env.example` (the MCP is a docker-compose service like Firefly/Redis, not bot-service application code); and the hedged "`mcp/README.md` (o `services/mcp/README.md`)" in 4.1/4.2 settled on `mcp/README.md` only.
- **Rationale:** the shared `scope-conflict-check.sh` script referenced by the skill (`${CLAUDE_PLUGIN_ROOT}/scripts/scope-conflict-check.sh`) was not present in this installation — only individual skill folders were installed via `npx skills add`, not the full plugin repo with its shared root scripts. Ran the equivalent check manually (grep all Owned File/Module Scope path declarations across the 35 stories, group by literal path string). Path-spelling drift between epics (different subagents naming the same file differently) would have made two references to the same real file look like two different files to any tooling doing literal path matching — fixed so the declared scope is trustworthy for future parallel/conflict tooling.
- **Made by:** bmad-epics-and-stories
- **Supersedes:** none

### 2026-09-11 — Scope-conflict check clean; all 35 stories flipped to ready-for-dev
- **Decision:** after the path standardization above, every remaining Owned Scope overlap across the 35 stories is either (a) within the same epic and already sequential by the epic's own story order, or (b) cross-epic and already covered by an explicit Blocked-by link or an explicit "Shared/contended — serializar" note. No silent/unaccounted overlap remains. All 35 Epic 0-8 stories set `status: ready-for-dev`.
- **Rationale:** per the skill's gate rule, a story is `ready-for-dev` once every section is complete, ACs are testable, scope is declared, and the conflict check is clean (or every remaining overlap is intentionally serialized) — all 35 stories meet this bar. `ready-for-dev` reflects planning completeness, not scheduling: actual build order is still governed by each story's Dependency Maps (Blocked-by/Blocks), not by withholding this status.
- **Made by:** bmad-epics-and-stories
- **Supersedes:** none

### 2026-09-11 — Track selected: bmad-method
- **Decision:** Initialized this project on the **bmad-method** track.
- **Rationale:** the auto-heuristic suggested `enterprise` on story-count alone
  (36 stories ≥ 30), but the actual scope signals point to `bmad-method`: single
  builder (no cross-team coordination), no formal compliance/regulatory
  requirement, and no need for dedicated Security/DevOps planning artifacts beyond
  what the existing architecture docs already cover. The project already has a
  mature PRD-equivalent (`docs/plan/backlog-scrum-completo.md`) and
  architecture-equivalent (`docs/plan/system-design-v2-multiusuario.md`), both
  assessed via `/bmad-readiness-check` (see `docs/plan/readiness-report-*.md`) —
  bmad-method is the track that matches this shape of work.
- **Made by:** bmad-init
- **Supersedes:** none

### 2026-09-11 — Pre-existing planning artifacts adopted as-is
- **Decision:** the informal planning corpus under `docs/plan/` (system design docs,
  scrum backlog, Mermaid diagrams) is treated as the project's PRD + Architecture
  equivalent rather than re-authoring them from scratch via `bmad-prd` /
  `bmad-architecture`.
- **Rationale:** `/bmad-readiness-check` scored this content at 100% FR/NFR/epic
  coverage and 100% architecture quality; re-planning would duplicate solid
  existing work. Three open concerns were logged instead of blockers: an
  unresolved PAT-provisioning spike, two parallel backlog documents
  (`backlog-plan-implementacion.md` superseded by `backlog-scrum-completo.md`),
  and a load test (HU-34) scheduled too late in the roadmap to catch an
  architecture-invalidating failure early.
- **Made by:** bmad-readiness-check
- **Supersedes:** none
