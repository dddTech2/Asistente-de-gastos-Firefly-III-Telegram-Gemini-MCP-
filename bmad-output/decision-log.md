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
