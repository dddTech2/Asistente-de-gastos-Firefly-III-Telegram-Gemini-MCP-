# Epics — Asistente de gastos (Firefly III + Telegram + Gemini + MCP)

> El mapa de épicas. Un índice liviano, no un objeto de contexto. Cada épica lista
> su objetivo, los requisitos que cubre, su lista ordenada de historias, y
> dependencias cruzadas. El detalle de cada historia vive en los archivos
> individuales `{epic}.{story}.{slug}.story.md`.
>
> Track: BMad Method
> Fuentes: `docs/plan/backlog-scrum-completo.md` (PRD/backlog equivalente),
> `docs/plan/system-design-v2-multiusuario.md` + `docs/plan/system-design-asistente-gastos.md`
> (architecture equivalente) — adoptadas como-están según
> `bmad-output/decision-log.md` (entrada 2026-09-11, "Pre-existing planning
> artifacts adopted as-is").

---

## Epic 0: Infraestructura base

**Goal:** Tener Firefly III + base de datos + reverse proxy + backups corriendo y
accesibles de forma segura, como fundación de todo lo demás.

**In scope (cited):**
- Despliegue de Firefly III + Postgres/MariaDB con Docker Compose [Source: docs/plan/backlog-scrum-completo.md#épica-0-infraestructura-base]
- Reverse proxy con HTTPS automático [Source: docs/plan/backlog-scrum-completo.md#épica-0-infraestructura-base]
- Redis + Postgres como servicios separados del bot [Source: docs/plan/system-design-v2-multiusuario.md#4-cambios-en-el-bot-service]
- NFR — Disponibilidad / cero pérdida de datos: backups diarios + restauración probada [Source: docs/plan/backlog-scrum-completo.md#épica-0-infraestructura-base]

**Architecture touchpoints:** Docker Compose, Firefly III, Postgres/MariaDB, Redis, reverse proxy (Nginx Proxy Manager / Traefik) [Source: docs/plan/backlog-plan-implementacion.md#1-stack-tecnológico-recomendado]

**Out of scope:** lógica del bot, autenticación de usuarios del bot (Epic 1).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 0.1 | firefly-docker-compose | Desplegar Firefly III + Postgres/MariaDB con Docker Compose | ready-for-dev |
| 0.2 | reverse-proxy-https | Reverse proxy con HTTPS automático | ready-for-dev |
| 0.3 | redis-postgres-servicios | Redis y Postgres como servicios separados del bot | ready-for-dev |
| 0.4 | backups-automaticos | Backups automáticos diarios de toda la base de datos | ready-for-dev |
| 0.5 | prueba-restauracion-backup | Probar una restauración completa desde backup | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: ninguna — es la épica fundacional.
- Blocks: Epic 1, Epic 2, Epic 3, Epic 4 (todas requieren la infraestructura corriendo).

---

## Epic 1: Autenticación y multi-tenancy

**Goal:** Cada uno de los ~50 usuarios tiene su propia cuenta Firefly III y PAT
cifrado, con aislamiento total de datos garantizado a nivel de credencial, no de
lógica custom.

**In scope (cited):**
- Flujo de alta de usuarios en Firefly III [Source: docs/plan/backlog-scrum-completo.md#épica-1-autenticación-y-multi-tenancy]
- Spike: ¿PAT vía API admin o login manual? [Source: docs/plan/system-design-v2-multiusuario.md#5-aprovisionamiento-de-usuarios-nuevo-en-v2]
- PAT cifrado en Postgres vinculado a `chat_id` [Source: docs/plan/backlog-scrum-completo.md#épica-1-autenticación-y-multi-tenancy]
- Whitelist de `chat_id` autorizados [Source: docs/plan/backlog-scrum-completo.md#épica-1-autenticación-y-multi-tenancy]
- NFR crítico — Aislamiento estricto entre usuarios (credenciales por-request en el MCP) [Source: docs/plan/system-design-v2-multiusuario.md#3-la-pieza-que-hace-viable-la-opción-b-credenciales-por-request-en-el-mcp]

**Architecture touchpoints:** Postgres (tabla de usuarios + PAT cifrado), API admin de Firefly III (`POST /api/v1/users`), Bot Service [Source: docs/plan/system-design-v2-multiusuario.md#5-aprovisionamiento-de-usuarios-nuevo-en-v2]

**Out of scope:** ejecución del bot en sí (Epic 2); uso del PAT en llamadas MCP reales (Epic 4).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 1.1 | whitelist-chat-id | El bot solo responde a `chat_id` registrados | ready-for-dev |
| 1.2 | spike-provisionamiento-pat | Spike: confirmar si el PAT se genera vía API admin o requiere login manual | ready-for-dev |
| 1.3 | alta-usuario-firefly | Flujo controlado de alta de cuentas Firefly III | ready-for-dev |
| 1.4 | pat-cifrado-postgres | Guardar el PAT de cada usuario cifrado en Postgres vinculado a `chat_id` | ready-for-dev |
| 1.5 | pat-por-request-mcp | Cada llamada al MCP usa el PAT del usuario que escribió el mensaje | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 0 (infraestructura).
- Blocks: Epic 4 (el MCP multi-tenant depende de 1.4/1.5), Epic 7 (app Android necesita una cuenta Firefly existente).

**Notas de secuencia:** 1.1 (whitelist) es liviana y se puede resolver junto con el
esqueleto del bot (Epic 2) antes que el resto de esta épica — así está en el
backlog original (Sprint 1). 1.2 (spike) debe resolverse **antes** de comprometer
el diseño final de 1.3 — ver concern del readiness check
(`docs/plan/readiness-report-asistente-gastos-2026-09-11.md`).

---

## Epic 2: Bot de Telegram (esqueleto)

**Goal:** Tener un bot de Telegram funcional que recibe webhooks y responde de
forma asíncrona, sin lógica de negocio todavía.

**In scope (cited):**
- Bot creado en BotFather + webhook configurado [Source: docs/plan/backlog-scrum-completo.md#épica-2-bot-de-telegram-esqueleto]
- Respuesta de confirmación al usuario [Source: docs/plan/backlog-scrum-completo.md#épica-2-bot-de-telegram-esqueleto]
- NFR — Concurrencia: ack inmediato + procesamiento asíncrono [Source: docs/plan/backlog-scrum-completo.md#épica-2-bot-de-telegram-esqueleto]

**Architecture touchpoints:** grammY/Telegraf (Node.js + TypeScript), webhook `POST /webhook/telegram` con `secret_token` [Source: docs/plan/system-design-asistente-gastos.md#2-high-level-design]

**Out of scope:** integración con Firefly III (Epic 3), lógica de IA (Epic 5).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 2.1 | bot-botfather-webhook | Crear bot en BotFather y configurar el webhook | ready-for-dev |
| 2.2 | bot-echo-response | El bot responde algo al usuario para confirmar que funciona | ready-for-dev |
| 2.3 | webhook-ack-asincrono | Confirmar webhook a Telegram inmediatamente y procesar de forma asíncrona | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 0.
- Blocks: Epic 3, Epic 5.

---

## Epic 3: Integración directa con Firefly III (sin IA todavía)

**Goal:** Validar el pipeline extremo a extremo (Telegram → Firefly III) con
comandos rígidos, antes de meter la capa de IA.

**In scope (cited):**
- Comando `/gasto` crea una transacción real [Source: docs/plan/backlog-scrum-completo.md#épica-3-integración-directa-con-firefly-iii-sin-ia-todavía]
- Comando de resumen de transacciones del mes [Source: docs/plan/backlog-scrum-completo.md#épica-3-integración-directa-con-firefly-iii-sin-ia-todavía]

**Architecture touchpoints:** API REST de Firefly III, PAT propio del desarrollador (fase de validación, previo a multi-tenancy) [Source: docs/plan/backlog-plan-implementacion.md#épica-2-integración-directa-con-firefly-iii-api-sin-ia-todavía]

**Out of scope:** MCP (Epic 4), lenguaje natural (Epic 5).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 3.1 | comando-gasto-manual | Comando `/gasto <monto> <concepto>` crea una transacción real | ready-for-dev |
| 3.2 | comando-resumen-mensual | Comando que lista transacciones del mes | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 2.
- Blocks: ninguna directa — es un checkpoint de validación, no un prerequisito técnico estricto de Epic 4.

---

## Epic 4: Servidor MCP

**Goal:** Tener el servidor MCP de Firefly III desplegado en modo multi-tenant
(credenciales por-request) y probado de forma aislada antes de conectarlo a Gemini.

**In scope (cited):**
- MCP en modo multi-tenant (credenciales por request) [Source: docs/plan/backlog-scrum-completo.md#épica-4-servidor-mcp]
- Prueba aislada con MCP Inspector [Source: docs/plan/backlog-scrum-completo.md#épica-4-servidor-mcp]
- Restricción del set de tools expuestas (sin acciones destructivas) [Source: docs/plan/backlog-scrum-completo.md#épica-4-servidor-mcp]

**Architecture touchpoints:** `@firefly-iii-mcp/server` (o equivalente Python), JSON-RPC (stdio/HTTP), `@modelcontextprotocol/inspector` [Source: docs/plan/system-design-v2-multiusuario.md#3-la-pieza-que-hace-viable-la-opción-b-credenciales-por-request-en-el-mcp]

**Out of scope:** integración con Gemini (Epic 5).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 4.1 | mcp-multitenant-deploy | Desplegar el MCP de Firefly III en modo multi-tenant | ready-for-dev |
| 4.2 | mcp-inspector-test | Probar el MCP de forma aislada con MCP Inspector | ready-for-dev |
| 4.3 | mcp-tools-restringidas | Limitar el set de tools expuestas por el MCP | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 1 (necesita el mecanismo de PAT por-request), Epic 3 (valida conectividad a Firefly primero).
- Blocks: Epic 5.

---

## Epic 5: Integración con Gemini (conversación en lenguaje natural)

**Goal:** El usuario puede registrar y consultar gastos escribiendo en lenguaje
natural, sin comandos rígidos.

**In scope (cited):**
- Bot Service arma prompt con historial + tools del MCP y llama a Gemini [Source: docs/plan/backlog-scrum-completo.md#épica-5-integración-con-gemini-conversación-en-lenguaje-natural]
- Registro de gasto en lenguaje natural [Source: docs/plan/backlog-scrum-completo.md#épica-5-integración-con-gemini-conversación-en-lenguaje-natural]
- Consulta de gasto en lenguaje natural [Source: docs/plan/backlog-scrum-completo.md#épica-5-integración-con-gemini-conversación-en-lenguaje-natural]
- Manejo de datos inválidos con aclaración en vez de fallo [Source: docs/plan/backlog-scrum-completo.md#épica-5-integración-con-gemini-conversación-en-lenguaje-natural]
- Memoria de conversación corta [Source: docs/plan/backlog-scrum-completo.md#épica-5-integración-con-gemini-conversación-en-lenguaje-natural]

**Architecture touchpoints:** Gemini API (`gemini-flash-latest`), `@modelcontextprotocol/sdk`, Redis (historial de conversación, TTL corto) [Source: docs/plan/system-design-v2-multiusuario.md#4-cambios-en-el-bot-service]

**Out of scope:** control de costos/rate limiting (Epic 6).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 5.1 | prompt-tools-gemini | Armar prompt con historial + tools del MCP y llamar a Gemini | ready-for-dev |
| 5.2 | registro-gasto-nl | "Gasté 20 mil en almuerzo" crea la transacción correcta | ready-for-dev |
| 5.3 | consulta-gasto-nl | "¿Cuánto llevo gastado en comida este mes?" responde correctamente | ready-for-dev |
| 5.4 | aclaracion-dato-invalido | Pedir aclaración cuando el dato es inválido, en vez de fallar en seco | ready-for-dev |
| 5.5 | memoria-conversacion-corta | Recordar contexto de los últimos mensajes | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 4.
- Blocks: Epic 6, Epic 9.

---

## Epic 6: Control de costos y concurrencia

**Goal:** El sistema absorbe ráfagas de mensajes de varios usuarios sin bloquearse
ni disparar el costo de la API de Gemini.

**In scope (cited):**
- Cola de procesamiento BullMQ + Redis [Source: docs/plan/backlog-scrum-completo.md#épica-6-control-de-costos-y-concurrencia]
- Rate limiting por usuario [Source: docs/plan/backlog-scrum-completo.md#épica-6-control-de-costos-y-concurrencia]
- Reintentos con backoff [Source: docs/plan/backlog-scrum-completo.md#épica-6-control-de-costos-y-concurrencia]
- Descarte de webhooks duplicados por `update_id` [Source: docs/plan/backlog-scrum-completo.md#épica-6-control-de-costos-y-concurrencia]

**Architecture touchpoints:** BullMQ, Redis, `update_id` de Telegram para idempotencia [Source: docs/plan/system-design-asistente-gastos.md#3-deep-dive]

**Out of scope:** observabilidad general (Epic 8).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 6.1 | webhook-dedup-update-id | Descartar webhooks duplicados usando `update_id` | ready-for-dev |
| 6.2 | cola-bullmq-redis | Cola de procesamiento BullMQ + Redis para mensajes entrantes | ready-for-dev |
| 6.3 | rate-limiting-por-usuario | Limitar mensajes por minuto por `chat_id` | ready-for-dev |
| 6.4 | reintentos-backoff | Reintentos automáticos con backoff ante fallos de Gemini/Firefly | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 2 (6.1 solo necesita el esqueleto del bot), Epic 5 (6.2-6.4 se benefician de tener el flujo de Gemini funcionando, aunque 6.1 puede adelantarse).
- Blocks: Epic 8 (HU-34 / 8.5, la prueba de carga, depende de que la cola y el rate limiting existan).

---

## Epic 7: App Android

**Goal:** Ofrecer un canal móvil sin desarrollo propio, usando Waterfly III como
cliente de Firefly III.

**In scope (cited):**
- Conectar Waterfly III con el PAT propio del usuario [Source: docs/plan/backlog-scrum-completo.md#épica-7-app-android]
- Evaluar si vale la pena una app Android propia [Source: docs/plan/backlog-scrum-completo.md#épica-7-app-android]

**Architecture touchpoints:** Waterfly III (app existente, conexión directa por PAT) [Source: docs/plan/backlog-plan-implementacion.md#1-stack-tecnológico-recomendado]

**Out of scope:** desarrollo de una app propia (se evalúa, no se construye en este track).

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 7.1 | waterfly-conexion-pat | Conectar Waterfly III a Firefly III con PAT propio | ready-for-dev |
| 7.2 | evaluacion-app-propia | Evaluar si vale la pena una app Android propia más adelante | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 1 (necesita una cuenta Firefly + PAT existentes).
- Blocks: ninguna.

---

## Epic 8: Observabilidad y hardening

**Goal:** Poder depurar problemas rápido, auditar qué hizo la IA, y confirmar que
la arquitectura aguanta 50 usuarios concurrentes antes de invitarlos a todos.

**In scope (cited):**
- Logs estructurados [Source: docs/plan/backlog-scrum-completo.md#épica-8-observabilidad-y-hardening]
- Tabla de auditoría de IA (`log_auditoria_ia`) [Source: docs/plan/system-design-asistente-gastos.md#3-deep-dive]
- Alertas de caída [Source: docs/plan/backlog-scrum-completo.md#épica-8-observabilidad-y-hardening]
- Rotación y protección de secretos [Source: docs/plan/backlog-scrum-completo.md#épica-8-observabilidad-y-hardening]
- NFR — Prueba de carga con 50 usuarios concurrentes [Source: docs/plan/backlog-scrum-completo.md#épica-8-observabilidad-y-hardening]

**Architecture touchpoints:** Uptime Kuma, tabla `log_auditoria_ia` en Postgres [Source: docs/plan/system-design-asistente-gastos.md#4-scale-and-reliability]

**Out of scope:** ninguno explícito.

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 8.1 | logs-estructurados | Logs estructurados de todo lo que hace el bot | ready-for-dev |
| 8.2 | tabla-auditoria-ia | Auditoría de qué escribió cada usuario y qué tool ejecutó la IA | ready-for-dev |
| 8.3 | rotacion-secretos | Rotar y proteger todos los secretos fuera del control de versiones | ready-for-dev |
| 8.4 | alertas-caida-servicio | Alertas si el bot o Firefly III se caen | ready-for-dev |
| 8.5 | prueba-carga-50-usuarios | Preparar entorno y cuentas sintéticas para la prueba de carga | ready-for-dev |
| 8.6 | ejecucion-reporte-prueba-carga | Ejecutar la prueba de carga de 50 usuarios y producir el reporte de veredicto | ready-for-dev |

**Cross-epic dependencies:**
- Blocked by: Epic 0 (8.1-8.4 son transversales, pueden empezar temprano); 8.5 (la prueba de carga) está bloqueada por Epic 1, 4, 5 y 6 — es la validación end-to-end de la apuesta arquitectónica completa.
- Blocks: ninguna — es la última compuerta antes de invitar a los 50 usuarios.

**Concern heredado del readiness check:** 8.5 estaba planificada al final del roadmap (Sprint 8 de 8) en el backlog original. El readiness check (`docs/plan/readiness-report-asistente-gastos-2026-09-11.md`) recomienda adelantar una versión preliminar/ligera de esta prueba (ej. 10-15 usuarios simulados) después de Epic 1-4, para no descubrir tarde que la Opción B de arquitectura (una sola instancia de Firefly III) no aguanta.

---

## Epic 9: Captura por notificaciones (backlog futuro, exploratorio)

**Goal:** Reducir la fricción de registro capturando automáticamente las
notificaciones de apps bancarias (Nequi, Bancolombia), con confirmación del
usuario antes de guardar.

**In scope (cited):**
- Captura automática de notificaciones y sugerencia de transacción [Source: docs/plan/backlog-scrum-completo.md#épica-9-captura-por-notificaciones-backlog-futuro-no-planificado-aún]
- Confirmación/descarte del usuario antes de guardar [Source: docs/plan/backlog-scrum-completo.md#épica-9-captura-por-notificaciones-backlog-futuro-no-planificado-aún]

**Architecture touchpoints:** `NotificationListenerService` (Android), pipeline texto → Gemini → MCP [Source: docs/plan/backlog-plan-implementacion.md#épica-6-captura-automática-por-notificaciones-exploratorio]

**Out of scope:** no está planificada para ejecución cercana — es explícitamente backlog futuro, no un compromiso de esta ronda de sharding.

**Stories (ordered):**

| ID | Slug | Intent | Status |
|------|------|--------|--------|
| 9.1 | notification-listener-prototipo | Prototipo de `NotificationListenerService` filtrando por paquete bancario | backlog |
| 9.2 | confirmacion-gasto-detectado | Confirmar o descartar cada gasto detectado automáticamente | backlog |

**Cross-epic dependencies:**
- Blocked by: Epic 5 (necesita el pipeline de interpretación vía Gemini/MCP).
- Blocks: ninguna.

**Nota:** por decisión explícita del Product Owner (ver `docs/plan/backlog-scrum-completo.md §5`), esta épica se prioriza recién después de tener los 50 usuarios estables — no antes. Se incluye en el mapa por completitud, pero no se recomienda compilar sus historias en esta ronda.

---

## Delivery Tracking (count-based)

No story points, velocity, ni burndown. Se trackea solo por CONTEO:

- Total stories: 37 (35 compiladas de Epic 0-8, +2 de Epic 9 exploratoria/no compilada)
- Compiladas como objetos de contexto (`bmad-output/stories/`): 35 (Epic 0-8)
- ready-for-dev: 35
- backlog: 2 (9.1, 9.2 — solo mapeadas, no compiladas; ver nota de Epic 9)
- Done: 0
- Remaining: 35 activas + 2 no planificadas
- Completion rate: 0/35

## Notes

- Secuencia recomendada (alineada con `docs/plan/backlog-scrum-completo.md §6`):
  Epic 0 → Epic 2 (parcial) → Epic 1.1 (whitelist) → Epic 3 → Epic 1 (resto) →
  Epic 4 → Epic 5 → Epic 6 → Epic 0 (resto: backups) / Epic 8 (parcial) → Epic 7 →
  Epic 8 (resto, incluyendo la compuerta 8.5/8.6).
- Epic 9 es exploratoria y no planificada — no se recomienda compilar sus
  historias todavía.
- Los tres concerns del readiness check (spike de PAT en Epic 1, backlog duplicado,
  timing de la prueba de carga en Epic 8) se llevaron como Dev Notes explícitas en
  las historias 1.2/1.3 y 8.5/8.6.
- **Split post-compilación:** la historia original "prueba de carga con 50 usuarios"
  se dividió en 8.5 (preparar entorno y cuentas sintéticas) + 8.6 (ejecutar y
  reportar) por exceder el tamaño de un dev-day. Ver `decision-log.md` (entrada
  2026-09-11 "Story 8.5 split").
