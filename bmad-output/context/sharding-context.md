# Sharding Context — shared by all epic agents

Project: Asistente de gastos (Firefly III + Telegram + Gemini + MCP)
Track: BMad Method (bmad-output/config.yaml)
Language: Spanish (all story content in Spanish)

## Source documents (read these directly — do not paraphrase from memory)

This project does NOT use native `prd.md` / `architecture.md`. Per
`bmad-output/decision-log.md` (entry "Pre-existing planning artifacts adopted
as-is"), the following existing docs ARE the PRD and architecture. Cite them
in Dev Notes using their real filenames (not `prd.md`/`architecture.md`):

- **Requirements / backlog (PRD-equivalent):**
  `docs/plan/backlog-scrum-completo.md` — authoritative. Contains the épica
  breakdown, user stories (HU-01..HU-36), Definition of Ready/Done, sprints.
  `docs/plan/backlog-plan-implementacion.md` — earlier version, superseded but
  still has useful stack-selection rationale (§1 Stack tecnológico).
- **Architecture:**
  `docs/plan/system-design-v2-multiusuario.md` — authoritative for the
  50-user multi-tenant design (isolation, provisioning, infra sizing).
  `docs/plan/system-design-asistente-gastos.md` — base v1 design (data
  model, contracts table, error handling, trade-offs) — still valid except
  where v2 explicitly supersedes it (SQLite → Postgres/Redis).
- **Project constitution:** `bmad-output/project-context.md`
- **Epic map (this run's output):** `bmad-output/epics.md` — your epic's
  block there is your scope contract: goal, in-scope items, architecture
  touchpoints, story list with IDs/slugs already assigned, cross-epic deps.
- **Known open risks to carry as Dev Notes where relevant** (from
  `docs/plan/readiness-report-asistente-gastos-2026-09-11.md`):
  1. PAT-provisioning spike unresolved (affects Epic 1 stories 1.2/1.3).
  2. `backlog-plan-implementacion.md` is superseded by
     `backlog-scrum-completo.md` — prefer the latter when they conflict.
  3. The 50-user load test (Epic 8, story 8.5) was scheduled last in the
     original roadmap — flag in 8.5's Dev Notes that an earlier lightweight
     load test is recommended.

## Story file naming and location

`bmad-output/stories/{epic}.{story}.{slug}.story.md` — use the EXACT id and
slug already assigned in `bmad-output/epics.md`'s story table for your epic.
Do not invent new ids or slugs.

## Template — use exactly this structure

`C:\Users\dazad\.claude\skills\bmad-epics-and-stories\templates\story.template.md`

Every section must be filled. Required sections in order: Story, Acceptance
Criteria (LOCKED), Tasks/Subtasks, Dev Notes (LOCKED), Testing (LOCKED),
Dependency Maps, Owned File/Module Scope, Learnings from Previous Stories,
Dev Agent Record (leave EMPTY).

## Rules (non-negotiable)

- **Sizing:** one dev-day max (~2-8h). Split further if a story from
  epics.md still looks too big once you detail it (see REFERENCE.md split
  heuristics at `C:\Users\dazad\.claude\skills\bmad-epics-and-stories\REFERENCE.md`)
  — but if you split, STOP and report back instead of silently renumbering,
  since epics.md would need a matching update.
- **No story points, no velocity, no Fibonacci.** Count-based only.
- **Citation discipline:** every Dev Notes claim needs
  `[Source: docs/plan/<file>.md#<section-anchor-or-heading>]`. Your own
  judgment calls get `[Inference]`. Never invent an architecture detail.
- **Testing section is strategy only** — never execute anything, never quote
  coverage numbers.
- **Owned File/Module Scope** must be path-precise (real paths this codebase
  WOULD use once built — infer sensible paths from the tech stack in
  `docs/plan/backlog-plan-implementacion.md §1` and `system-design-v2-multiusuario.md`
  — e.g. Node/TS Bot Service, Docker Compose files, MCP config). Since no
  code exists yet, declare the paths the story WILL create, not paths that
  exist today. Flag any file two stories in your own epic would both need to
  touch as "Shared/contended".
- **Status:** set `backlog` for every story (main session will flip to
  `ready-for-dev` after the cross-epic scope-conflict pass).
- **Tasks must map to ACs** via `(AC: #N)`.
- Do NOT write application code, do NOT run anything, do NOT create files
  outside `bmad-output/stories/`.

## Cross-epic dependencies you should reference (from epics.md)

Read the "Cross-epic dependencies" block for your epic in
`bmad-output/epics.md` and reflect the relevant ones in each story's
Dependency Maps section (Blocked-by / Blocks may point to a specific story
ID in another epic when epics.md is specific enough, otherwise reference the
epic-level dependency).

## Output

One `.story.md` file per story listed for your epic in `epics.md`, all with
`status: backlog`. Report back: the list of files you created, and any
sizing/scope concerns you flagged instead of silently resolving.
