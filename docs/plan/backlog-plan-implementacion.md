# Asistente de gastos con IA — Backlog y plan de implementación

Basado en Firefly III (self-hosted) + Telegram + Gemini + MCP + App Android.

---

## 1. Stack tecnológico recomendado

| Componente | Tecnología | Por qué |
|---|---|---|
| Backend financiero | **Firefly III** (PHP/Laravel) | Ya definido — API REST completa, doble partida |
| Base de datos | **MariaDB** | Es la recomendada oficialmente por Firefly III |
| MCP Server | **`@firefly-iii-mcp/server`** (Node/TS) o **`firefly-iii-mcp-server`** (Python) | Ya existen, no hay que programarlos. Elige el que comparta lenguaje con tu Bot Service |
| Bot Service | **Node.js + TypeScript**, con **grammY** o **Telegraf** para Telegram | Mismo lenguaje que el MCP de Node → un solo stack, menos fricción |
| LLM | **Gemini API**, modelo `gemini-flash-latest` (alias que Google mantiene apuntando al Flash más reciente) | Rápido y barato para function calling conversacional; usa el alias en vez de fijar versión para no quedar obsoleto |
| Cliente MCP en el bot | **`@modelcontextprotocol/sdk`** (TypeScript oficial) | Traduce las tools del MCP al formato de function calling de Gemini |
| Infraestructura | **Docker Compose** en un único VPS (2 vCPU / 4GB RAM alcanza para MVP) | Todo el stack de Firefly ya se distribuye así oficialmente |
| Reverse proxy | **Nginx Proxy Manager** o **Traefik** + Let's Encrypt | HTTPS automático, expones solo lo necesario |
| App Android (MVP) | **Waterfly III** (ya existe, gratuita, se conecta por PAT) | No reinventes la rueda en el MVP; evalúa app propia después |
| Backups | **restic** o **mysqldump + cron** hacia almacenamiento externo (S3/Backblaze) | Es dinero real, no puede depender solo del disco del VPS |
| Monitoreo (opcional) | **Uptime Kuma** | Liviano, se instala en el mismo servidor |

---

## 2. Backlog por épicas

**Prioridad:** P0 = bloqueante para tener algo funcional · P1 = importante pero no bloqueante · P2 = mejora / exploratorio
**Tamaño:** S (horas) · M (1-2 días) · L (varios días)

### Épica 0 — Infraestructura base
- [ ] **P0 / S** — Desplegar Firefly III + MariaDB con Docker Compose en el servidor
- [ ] **P0 / S** — Configurar reverse proxy con HTTPS (dominio o subdominio propio)
- [ ] **P0 / M** — Backups automáticos diarios de la BD (cron + restic/rclone a almacenamiento externo)
- [ ] **P0 / S** — `.env` con secretos fuera del repo, permisos de archivos correctos

### Épica 1 — Bot de Telegram (esqueleto)
- [ ] **P0 / S** — Crear bot en @BotFather, guardar token
- [ ] **P0 / S** — Bot Service recibe webhook y responde un echo simple
- [ ] **P0 / S** — Whitelist de `chat_id` autorizados (nadie más puede usar tu instancia)

### Épica 2 — Integración directa con Firefly III API (sin IA todavía)
> Objetivo: validar el pipeline de extremo a extremo antes de meter la capa de IA.
- [ ] **P0 / S** — Generar Personal Access Token en Firefly III
- [ ] **P0 / M** — Comando manual `/gasto 20000 almuerzo` crea una transacción real vía API REST
- [ ] **P1 / S** — Comando `/resumen` lista transacciones del mes

### Épica 3 — Servidor MCP
- [ ] **P0 / M** — Desplegar el MCP de Firefly III (Docker) apuntando a tu instancia con el PAT
- [ ] **P0 / M** — Probarlo con **MCP Inspector** (`npx @modelcontextprotocol/inspector`) antes de conectarlo a nada más
- [ ] **P1 / S** — Restringir el set de tools expuestas (preset `budget` o `basic`) — que la IA no pueda, por ejemplo, borrar cuentas

### Épica 4 — Integración con Gemini (conversación en lenguaje natural)
- [ ] **P0 / M** — Bot Service arma prompt de sistema + historial corto + definiciones de tools del MCP, llama a Gemini
- [ ] **P0 / L** — "Gasté 20 mil en almuerzo" → Gemini llama la tool `create_transaction` con los parámetros correctos
- [ ] **P0 / M** — "¿Cuánto llevo gastado en comida este mes?" → Gemini llama tools de consulta y resume
- [ ] **P1 / M** — Si Firefly rechaza el dato (cuenta/categoría inválida), Gemini le pide aclaración al usuario en vez de fallar en seco
- [ ] **P1 / S** — Memoria de conversación corta (últimos N mensajes) por `chat_id`

### Épica 5 — App Android
- [ ] **P0 / S** — Instalar Waterfly III, conectarlo con un PAT propio
- [ ] **P2 / M** — Evaluar si vale la pena una app propia (Waterfly III cubre el 90% de los casos)

### Épica 6 — Captura automática por notificaciones (exploratorio)
- [x] **P0** — Spike de viabilidad técnica/legal (ya hecho: Wallet no viable, Nequi no viable vía API pública, notificaciones sí)
- [ ] **P2 / L** — Prototipo de `NotificationListenerService` filtrando por paquete (Nequi, Bancolombia, etc.)
- [ ] **P2 / M** — Pipeline: texto de notificación → Gemini interpreta → crea transacción vía MCP
- [ ] **P2 / M** — Pantalla de confirmación antes de guardar (evita falsos positivos silenciosos)

### Épica 7 — Hardening
- [ ] **P1 / S** — Logs estructurados del Bot Service
- [ ] **P1 / M** — Rate limiting por usuario (cuida costos de la API de Gemini)
- [ ] **P0 / S** — Rotación de secretos / revisar que nada quede expuesto en el reverse proxy
- [ ] **P2 / M** — Alertas de caída con Uptime Kuma

---

## 3. Roadmap sugerido

| Fase | Duración estimada | Entregable |
|---|---|---|
| **Fase 0 — Fundaciones** | Semana 1 | Firefly III corriendo, accesible por HTTPS, con backups |
| **Fase 1 — Bot esqueleto** | Semana 2 | Telegram crea/lista transacciones a mano (sin IA), valida todo el cableado |
| **Fase 2 — MCP + Gemini** | Semana 3 | Primera conversación en lenguaje natural funcionando de punta a punta |
| **Fase 3 — Pulido** | Semana 4 | Manejo de errores, memoria de conversación, rate limiting, Waterfly III conectado |
| **Fase 4 — Exploración** | Después del MVP | Prototipo de captura por notificaciones, solo si las fases anteriores están estables |

La idea de meter la **Épica 2 antes que la 3 y 4** es a propósito: si algo falla, sabes si el problema está en Firefly/red (fase 2) o en la capa de IA (fase 3-4), en vez de depurar todo junto.

---

## 4. Checklist para arrancar hoy

1. **Cuentas/accesos:**
   - Crear bot en Telegram con `@BotFather` → guardar el token
   - Crear API key de Gemini en [Google AI Studio](https://aistudio.google.com/)
   - Tener un VPS con Docker y Docker Compose instalados (o instalarlos)
2. **Levantar Firefly III:**
   - Usar el `docker-compose.yml` oficial de Firefly III (está en su documentación)
   - `docker compose up -d`, crear tu usuario admin, generar un Personal Access Token
3. **Probar el MCP de forma aislada:**
   - Levantar el contenedor del MCP de Firefly III apuntando a tu instancia
   - Verificarlo con `npx @modelcontextprotocol/inspector` antes de conectar nada más — así confirmas que las tools responden bien
4. **Crear el repo del Bot Service:**
   - Node.js + TypeScript, `grammY` para Telegram, SDK de Gemini, SDK de MCP
   - Empezar con un echo simple, luego ir sumando capas (whitelist → Firefly directo → MCP → Gemini)
5. **Conectar Waterfly III** a tu Firefly III con el PAT, para tener el canal móvil desde el día uno mientras avanzas con el bot.
