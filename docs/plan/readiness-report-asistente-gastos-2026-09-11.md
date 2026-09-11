# BMAD Readiness Report

**Date:** 2026-09-11
**Project:** Asistente de gastos (Firefly III + Telegram + Gemini + MCP)
**Track:** BMad Method _(adaptado — el proyecto no usa la estructura nativa `bmad-output/`)_
**Requirements doc:** `docs/plan/backlog-scrum-completo.md` (+ `docs/plan/backlog-plan-implementacion.md`, versión previa)
**Architecture doc:** `docs/plan/system-design-v2-multiusuario.md` (+ `docs/plan/system-design-asistente-gastos.md`, base v1)

---

## Verdict

**CONCERNS**

La cobertura de contenido es alta (requisitos, NFRs y épicas están bien mapeados a la arquitectura), pero hay dependencias abiertas sin resolver — un spike técnico pendiente que condiciona el diseño de una épica crítica de seguridad, dos documentos de backlog en paralelo sin marcar cuál es la fuente de verdad, y la validación de la apuesta arquitectónica central (una sola instancia de Firefly III para 50 usuarios) programada hasta el final del roadmap. Ninguno es bloqueante hoy, pero conviene resolverlos antes o durante los sprints que dependen de ellos.

**Nota de estructura:** bajo el chequeo estricto de BMAD (`bmad-readiness-check` script), el veredicto pre-flight es **FAIL** porque no existe `bmad-output/` ni archivos `prd*.md` / `architecture*.md`. Ese FAIL es sobre la *forma* del workspace, no sobre el contenido — el proyecto sí tiene un PRD y una arquitectura equivalentes, solo que con otro nombre y ubicación.

---

## Requirements Coverage

### Functional Requirements

| Metric | Value |
|--------|-------|
| Total FRs identified (sin etiquetar formalmente) | 6 |
| Covered in architecture (explicit) | 4 |
| Implied / subject-matter coverage | 2 |
| Missing — no evidence of coverage | 0 |
| **Coverage %** (covered + implied) | **100 %** |

**Threshold:** PASS ≥ 90 % · CONCERNS 80–89 % · FAIL < 80 %

#### Missing or Partially Covered FRs

- **FR5 — Captura semi-automática desde notificaciones bancarias.** Documentada como backlog futuro explícitamente no planificado (Épica 9 / Épica 6 exploratoria). No es una omisión — es una decisión de alcance deliberada — pero si alguien retoma el proyecto sin este contexto podría leerlo como "falta diseñar". Sugerencia: dejar una nota de una línea en el system-design explicando por qué se pospuso.
- **FR6 — Aprovisionamiento de usuarios (alta automatizada con generación de PAT).** Arquitectura lo direcciona (`system-design-v2-multiusuario.md §5`) pero deja explícitamente abierto si el PAT se puede generar vía API admin o requiere login manual del usuario. Esto es un **spike técnico sin resolver**, no una ausencia de diseño — ver Concerns.

---

### Non-Functional Requirements

| Metric | Value |
|--------|-------|
| Total NFRs identified | 8 |
| Fully addressed in architecture | 8 |
| Partially addressed | 0 |
| Missing — no architecture strategy | 0 |
| **Coverage %** (addressed + partial) | **100 %** |

**Threshold:** PASS ≥ 90 % · CONCERNS 80–89 % · FAIL < 80 %

#### NFR Coverage Detail

| NFR | Status | Architecture Strategy | Notes |
|-----|--------|----------------------|-------|
| Latencia | Addressed | Gemini Flash como default, objetivo <5s | Sin mecanismo de medición/alerta si se excede |
| Seguridad | Addressed | PAT cifrado en Postgres, TLS, whitelist de `chat_id`, secret_token en webhook | HU-10 marcada correctamente como "crítica de seguridad, no negociable" |
| Aislamiento multiusuario | Addressed | Credenciales por-request en el MCP (el PAT del usuario viaja en cada llamada, aislamiento lo hace Firefly III, no código propio) | Es la decisión arquitectónica más sólida del documento — bien justificada y con plan de validación (HU-34) |
| Concurrencia | Addressed | Bot Service stateless, cola BullMQ + Redis, ack inmediato a Telegram | Consistente entre v2 y el backlog (HU-13, HU-24) |
| Costo | Addressed | Modelo Flash, rate limiting por `chat_id` (HU-25) | Sin número concreto de "N mensajes/minuto" todavía — se deja como parámetro a calibrar, razonable en esta etapa |
| Disponibilidad / pérdida de datos | Addressed | Backups diarios + prueba de restauración obligatoria (HU-04, HU-05) | Buena práctica explícita: "un backup que nunca restauraste no es un backup" |
| Escalabilidad | Addressed | Postgres/Redis separados del proceso del bot, vertical primero, spike de carga con 50 usuarios (HU-34) | Ver Concern sobre el timing de HU-34 |
| Privacidad | Addressed | Self-hosted, nada sale del servidor salvo Telegram/Gemini | Consistente con la decisión self-hosted del stack |

_(Status values: Addressed · Partial · Missing)_

---

## Epic / Story Traceability

| Metric | Value |
|--------|-------|
| Total epics | 10 (Épica 0–9 en `backlog-scrum-completo.md`) |
| Epics linked to a requirement | 10 |
| Orphan epics (no traceable requirement) | 0 |
| Total story files found | 36 historias de usuario (HU-01 a HU-36), sin archivos `.story.md` individuales — viven todas en un solo documento |

**Threshold:** PASS = all linked · CONCERNS ≥ 80 % linked · FAIL < 80 %

#### Orphan Epics

None. Cada épica traza claramente a un FR o NFR (ej. Épica 1 → NFR aislamiento, Épica 6 → NFR costo/concurrencia, Épica 8 → NFR seguridad/disponibilidad).

---

## Architecture Quality

**Score:** 100 % (10 / 10 checks)

**Threshold:** PASS ≥ 80 % · CONCERNS 70–79 % · FAIL < 70 %

| Check | Result |
|-------|--------|
| Architectural pattern stated | PASS _(monolito de un solo host, vertical antes que horizontal, explícito)_ |
| Components / modules defined | PASS _(Bot Service, MCP Server, Firefly III, Gemini, Telegram)_ |
| API or service contracts described | PASS _(tabla de contratos explícita: webhook, tool definitions, tool execution, persistencia)_ |
| Data model or entities specified | PASS _(usuarios_autorizados, historial_conversacion, log_auditoria_ia)_ |
| Technology stack present | PASS _(tabla completa en `backlog-plan-implementacion.md §1`)_ |
| Technology choices justified | PASS _(tablas de trade-off extensas en ambos documentos)_ |
| Security strategy addressed | PASS |
| Scalability or performance addressed | PASS |
| Trade-offs documented | PASS _(sección 5 de v1, tabla de opción A/B en v2)_ |
| Assumptions or constraints listed | PASS _(ambos documentos declaran supuestos explícitamente)_ |

---

## Issues Summary

### Blockers — must fix before implementation begins

None. No hay ninguna épica cuyo diseño esté totalmente indefinido o sin arquitectura de respaldo.

### Concerns — address during story refinement

1. **Spike de aprovisionamiento de PAT sin resolver** (`system-design-v2-multiusuario.md §5`). Condiciona si HU-06 (alta de usuario) se puede automatizar por completo o queda semi-manual. Está correctamente identificado como HU-07, pero ambas historias comparten el mismo sprint (Sprint 2). **Acción:** ejecutar HU-07 como la primera tarea del Sprint 2, antes de comprometer el diseño final de HU-06/HU-08, para no construir sobre un supuesto no confirmado.
2. **Dos backlogs en paralelo sin marcar cuál es la fuente de verdad.** `backlog-plan-implementacion.md` (8 épicas, sizing S/M/L) y `backlog-scrum-completo.md` (10 épicas, story points, explícitamente "actualizado para v2") describen el mismo proyecto con desgloses distintos. El segundo referencia al primero como base, pero el primero no está marcado como superseded. **Acción:** agregar una nota al inicio de `backlog-plan-implementacion.md` indicando que fue reemplazado por `backlog-scrum-completo.md`, o archivarlo en una subcarpeta `docs/plan/archive/`.
3. **La prueba de carga que valida la apuesta arquitectónica central (HU-34) está en el último sprint (Sprint 8 de 8).** Toda la arquitectura v2 se apoya en que "una instancia de Firefly III para 50 usuarios" aguanta la carga — si esa prueba falla tarde, invalida trabajo de 6 sprints previos. **Acción:** considerar una prueba de carga ligera/preliminar después del Sprint 2 o 3 (con datos sintéticos, aunque sea con 10-15 usuarios simulados) para detectar temprano si la Opción B no es viable, en vez de descubrirlo al final.

### Minor observations

- Los requisitos y NFRs no usan IDs formales (`FR-001`, `NFR-001`). Para un desarrollador único esto no genera fricción real hoy, pero si el proyecto crece en colaboradores o se usa `bmad-epics-and-stories` para generar historias adicionales, agregar IDs facilitaría la trazabilidad automática.
- No hay un documento de UX dedicado — razonable dado que la interfaz es conversacional (Telegram) sin UI gráfica propia; no se considera una omisión.
- Los diagramas Mermaid (`arquitectura-firefly-gemini-telegram.mermaid`, `diagrama-secuencia-flujo-chat.mermaid`, `diagrama-actividades-flujo-chat.mermaid`) no se revisaron en detalle en este check — vale la pena una pasada rápida para confirmar que siguen sincronizados con el texto de v2 (que reemplazó SQLite por Postgres/Redis, por ejemplo).

---

## Recommendations

1. Resolver el spike de aprovisionamiento de PAT (HU-07) antes de tocar código de HU-06/HU-08.
2. Marcar `backlog-plan-implementacion.md` como reemplazado por `backlog-scrum-completo.md`, o archivarlo, para que no queden dos fuentes de verdad.
3. Adelantar una prueba de carga preliminar (aunque sea parcial) antes del Sprint 8, para validar temprano la Opción B de arquitectura.
4. Confirmar que los diagramas Mermaid reflejan el modelo de datos v2 (Postgres/Redis) y no el v1 (SQLite).
5. Si el proyecto crece más allá de uso solo-dev, considerar formalizar requisitos con IDs (`FR-`/`NFR-`) para habilitar trazabilidad automática con las demás skills de BMAD.

---

## Gate Decision

**Verdict: CONCERNS**

**Rationale:** cobertura de requisitos, NFRs, arquitectura y trazabilidad de épicas es del 100 % en contenido — la planeación es sólida y más detallada de lo típico para un proyecto solo-dev. El veredicto es CONCERNS y no PASS porque hay tres riesgos reales y accionables (spike abierto, documentos duplicados, validación de carga tardía) que conviene resolver antes de construir sobre ellos, no porque falte cobertura.

### Next steps sugeridos (CONCERNS)
La planeación central es sólida. Se puede proceder a implementación con precaución:
- Llevar los 3 concerns como Dev Notes explícitas en las historias HU-06, HU-07, HU-08 y HU-34.
- Re-validar con `/bmad-readiness-check` si el spike de HU-07 cambia el diseño de HU-06 de forma sustancial.
- Opcional: correr `/bmad-epics-and-stories` solo si quieres convertir estas 36 historias en archivos `.story.md` individuales con Dev Notes citando estas fuentes — el backlog actual ya es utilizable tal cual para arrancar Sprint 0.

---

## Next Step

El backlog y la arquitectura ya están listos para empezar el **Sprint 0 — Fundaciones** (HU-01, HU-02, HU-03, HU-11) tal como está planeado en `backlog-scrum-completo.md §6`. No es necesario re-planear desde cero con BMAD — los artefactos existentes cumplen la misma función que un PRD + architecture.md nativos. Atender los 3 concerns listados arriba durante los sprints correspondientes (2 y 8) en vez de bloquear el arranque.

---

_BMAD Planning & Orchestrator · Readiness Check · adaptado manualmente sobre artefactos de planeación pre-existentes (no nativos de `bmad-output/`) · tracks `bmad-check-implementation-readiness` from the BMAD Method by the BMAD Code Organization (https://github.com/bmad-code-org/BMAD-METHOD)_
