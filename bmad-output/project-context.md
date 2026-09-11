# Project Context — Asistente de gastos (Firefly III + Telegram + Gemini + MCP)

> The project **constitution**. This document is loaded by every BMAD planning skill
> so they all share the same ground truth. Keep it tight, current, and authoritative.
> When a major decision changes scope, update this file and append the change to
> `decision-log.md`.

- **Track:** bmad-method  _(quick-flow | bmad-method | enterprise)_
- **Created:** 2026-09-11T21:34:46Z

---

## Project Goal

Ofrecer a un grupo cerrado de hasta ~50 usuarios un asistente conversacional para
registrar y consultar sus gastos personales por Telegram usando lenguaje natural,
respaldado por Firefly III (self-hosted) como motor financiero de doble partida.
"Done and successful" = los usuarios registran/consultan gastos sin fricción vía
chat, con aislamiento total de datos entre ellos, y la arquitectura soporta los 50
usuarios concurrentes sin degradar latencia ni perder datos.

## Primary Users

Personas que quieren control total de sus gastos personales sin depender de una app
de terceros ni llenar formularios — empezando por el propio desarrollador/su hogar y
extendiéndose a un grupo cerrado de conocidos (~50 personas). Valoran privacidad
(self-hosted, sin SaaS de por medio) y una interfaz conversacional en vez de UI
tradicional.

## Scope

Épicas principales (detalle completo en `docs/plan/backlog-scrum-completo.md`):
infraestructura base (Docker Compose, HTTPS, backups) · autenticación y
multi-tenancy (aislamiento de datos por usuario) · bot de Telegram · integración
directa con la API de Firefly III · servidor MCP en modo multi-tenant · integración
con Gemini para conversación en lenguaje natural · control de costos y concurrencia
(colas, rate limiting) · canal móvil vía Waterfly III · observabilidad y hardening ·
captura por notificaciones bancarias (exploratorio, backlog futuro).

## Core Constraints

- Un solo desarrollador, manteniendo el sistema en su tiempo libre — sin equipo de
  operaciones.
- Todo self-hosted en un único VPS (4 vCPU / 8GB como piso para 50 usuarios); nada
  de Kubernetes ni multi-región.
- Firefly III es la **única fuente de verdad** de los datos financieros — el Bot
  Service nunca guarda su propia copia del estado de negocio.
- Modelo Gemini Flash como default (control de costo); subir a Pro solo si hace
  falta.
- El aislamiento de datos entre usuarios se resuelve pasando el PAT de cada usuario
  por-request al MCP — no debe implementarse como lógica de aislamiento custom.

## Non-Goals

- No es un producto SaaS comercial con SLA contractual.
- No está diseñado para escalar a millones de usuarios ni múltiples regiones.
- No reemplaza a Firefly III como motor financiero — es una capa conversacional
  sobre él.
- Captura automática desde notificaciones bancarias (Épica 9) es exploratoria, no
  un compromiso de roadmap actual.
- No se construye una app Android propia mientras Waterfly III cubra el caso de
  uso (~90% según evaluación en `system-design-asistente-gastos.md`).

## Key Stakeholders / Roles

Un solo builder cubre los tres roles de Scrum (Product Owner, Scrum Master, Dev
Team). Se recomienda reclutar 1-2 beta testers del grupo de 50 usuarios para dar
feedback real en cada Sprint Review — ver
`docs/plan/backlog-scrum-completo.md §2`.

## Glossary

- **PAT** — Personal Access Token de Firefly III; credencial por usuario, se pasa
  por-request al MCP para aislar datos entre usuarios.
- **MCP** — Model Context Protocol; expone las tools de Firefly III a Gemini como
  function calling.
- **chat_id** — identificador de usuario de Telegram; clave de aislamiento y
  whitelist de acceso.
- **Firefly III** — motor financiero self-hosted de doble partida (PHP/Laravel);
  única fuente de verdad de datos financieros.
- **Waterfly III** — app Android existente que se conecta a Firefly III vía PAT;
  canal móvil del MVP sin desarrollo propio.

---

## Decision Thread

Running decisions live in [`decision-log.md`](./decision-log.md). The first entry is
the track choice from initialization. Consult it before making decisions that might
contradict earlier ones.

## Planning Status (count-based)

- **Track:** bmad-method
- **Stories defined:** 37 total (10 épicas en `epics.md`) — 35 compiladas como objetos
  de contexto completos en `stories/` (Epic 0-8, todas `ready-for-dev`), 2 solo
  mapeadas sin compilar (Epic 9, exploratoria, no planificada)
- **Stories remaining:** 35 activas (0 done) + 2 no planificadas
- **Última compilación:** 2026-09-11 vía `/bmad-epics-and-stories` (9 subagentes en
  paralelo, uno por épica) + chequeo manual de conflictos de Owned Scope + split de
  8.5 → 8.5/8.6 por exceder tamaño de un dev-day

_This document plans the work. Implementation is handed to external dev tools via
ready-for-dev story files; the planning plugin never writes or tests application code._
