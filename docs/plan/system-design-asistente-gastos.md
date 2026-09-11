# System Design — Asistente de gastos (Firefly III + Telegram + Gemini + MCP)

> Aplico el framework de diseño de sistemas al proyecto que venimos armando. Donde no tengo un dato tuyo explícito, lo marco como **supuesto** — corrígelo si no aplica.

---

## 1. Requirements Gathering

### Funcionales
- El usuario registra gastos/ingresos por lenguaje natural vía Telegram.
- El usuario consulta gastos, presupuestos y resúmenes vía Telegram.
- El usuario registra/consulta gastos vía app Android (Waterfly III → Firefly III directo).
- Firefly III es la **única fuente de verdad** de los datos financieros.
- (Fase futura) Captura semi-automática de gastos desde notificaciones de apps bancarias.

### No funcionales
- **Latencia**: respuesta del bot en Telegram idealmente < 5s (incluye ida y vuelta a Gemini + Firefly).
- **Disponibilidad**: uso personal/familiar — no necesitas 99.99%, pero sí **cero pérdida de datos** (es dinero real).
- **Escala** *(supuesto)*: 1 persona o un hogar pequeño, del orden de decenas de mensajes/día, no miles. Esto condiciona casi todas las decisiones de abajo.
- **Costo**: minimizar tokens de Gemini — modelo Flash, no Pro, como default.
- **Seguridad**: datos financieros personales → TLS en tránsito, tokens con el menor alcance posible, todo self-hosted.
- **Privacidad**: nada sale de tu servidor salvo las llamadas inevitables a Telegram y Gemini.

### Restricciones
- Un solo desarrollador (tú), manteniendo el sistema en tu tiempo libre.
- Un VPS modesto (2 vCPU / 4GB alcanza para este volumen).
- Sin equipo de operaciones — todo debe ser lo bastante simple para que lo mantengas solo.

**Consecuencia directa de estos requisitos:** este NO es un sistema que necesite colas distribuidas, Kubernetes, sharding de base de datos ni un stack de observabilidad pesado. Diseñar para eso sería sobre-ingeniería. Lo priorizo abajo.

---

## 2. High-Level Design

El diagrama de componentes y el de secuencia ya los hicimos en los mensajes anteriores (`arquitectura-firefly-gemini-telegram.mermaid` y `diagrama-secuencia-flujo-chat.mermaid`) — los doy como referencia base y no los repito acá.

**Contratos clave que faltaban precisar:**

| Contrato | Entre | Forma |
|---|---|---|
| Webhook entrante | Telegram → Bot Service | `POST /webhook/telegram`, protegido con el `secret_token` que provee la API de Telegram (no vale solo con la URL secreta) |
| Tool definitions | Bot Service → Gemini | El MCP expone sus tools con JSON Schema; el Bot Service las traduce a `functionDeclarations` de Gemini en cada llamada |
| Tool execution | Bot Service → MCP Server | JSON-RPC estándar de MCP (stdio o HTTP, según el server que elijas) |
| Persistencia | MCP → Firefly III | REST/OAuth2, ya definido |

**Regla de oro de storage:** el Bot Service **no debe guardar su propia copia de los datos financieros**. Firefly III es la única fuente de verdad. El Bot Service solo persiste *estado de conversación*, no *estado de negocio* — evita el problema clásico de tener dos sistemas que se desincronizan.

---

## 3. Deep Dive

### Modelo de datos del Bot Service (lo mínimo que necesita tener propio)

```
usuarios_autorizados
 ├─ chat_id (PK)
 ├─ nombre
 └─ fecha_alta

historial_conversacion
 ├─ chat_id (FK)
 ├─ rol (user/model)
 ├─ contenido
 └─ timestamp   -- TTL corto, ej. purgar > 24h

log_auditoria_ia
 ├─ chat_id
 ├─ mensaje_original
 ├─ tool_llamada
 ├─ parametros
 ├─ resultado (éxito/error)
 └─ timestamp
```

`log_auditoria_ia` es la tabla que más vas a agradecer tener: si un día Gemini interpreta mal un monto o categoriza algo raro, necesitas poder ver *qué le escribiste* y *qué tool llamó con qué parámetros*, sin tener que adivinar. Con volumen bajo, todo esto cabe perfecto en **SQLite** — no justifica un Postgres/Redis aparte.

### Caching
- Cachear en memoria el listado de cuentas/categorías/presupuestos de Firefly (cambia poco) con TTL de minutos, para no pedirlo en cada mensaje. Invalidar cuando el usuario crea una cuenta/categoría nueva.

### Error handling y reintentos
- **Idempotencia**: usar el `update_id` de Telegram para descartar webhooks duplicados (Telegram reintenta si no respondes a tiempo).
- **Reintentos con backoff** en llamadas a Gemini (rate limits) y a Firefly (timeouts de red).
- **Circuit breaker simple**: si Firefly no responde en N intentos, el bot contesta "servicio no disponible por ahora" en vez de dejar al usuario esperando o duplicar la operación.

### Colas/eventos
Con el volumen actual, **no hace falta cola**. Se vuelve necesaria solo si activas la Épica 6 (notificaciones): ahí sí conviene meter una cola liviana (BullMQ + Redis) para no bloquear el listener de notificaciones y poder reintentar sin perder eventos si Gemini o Firefly están caídos en ese momento.

---

## 4. Scale and Reliability

- **Estimación de carga**: decenas de mensajes/día → un VPS pequeño sobra. No hay que diseñar para picos que no vas a tener.
- **Vertical, no horizontal**: si algún día esto crece a "producto para más gente", ahí sí se replantea. Para uso propio, escalar verticalmente (subir el VPS de tamaño) es más simple y más barato que pensar en réplicas.
- **El verdadero riesgo no es la disponibilidad, es la pérdida de datos.** Prioriza:
  1. Backups automáticos diarios de la BD de Firefly.
  2. **Probar la restauración** al menos una vez (un backup que nunca restauraste no es un backup, es una promesa).
- **Monitoreo**: Uptime Kuma + logs es suficiente. Un stack tipo Prometheus/Grafana sería sobre-ingeniería para este tamaño — mejor gastar ese tiempo en el bot.

---

## 5. Trade-off Analysis

| Decisión | A favor | Costo / riesgo |
|---|---|---|
| **Self-hosted** vs SaaS | Control total de tus datos financieros | Tú eres el equipo de operaciones: updates, backups, seguridad |
| **MCP comunitario** vs escribir el propio | Arrancas en horas, no en semanas | Es código de terceros con acceso a tus credenciales financieras — **revísalo antes de correrlo**, o prioriza el repo con más actividad/estrellas |
| **Bot Service artesanal** vs framework de agentes (LangChain, etc.) | Menos abstracción, debug más directo, entiendes cada línea | Más código propio que mantener vos mismo |
| **Gemini Flash** vs Pro | Más barato y rápido | Puede fallar más en casos ambiguos — arranca con Flash, mide la tasa de error real, sube a Pro solo si hace falta |
| **Waterfly III** vs app propia | Cero esfuerzo de desarrollo | Cero personalización — si algún día quieres UX propia, hay que migrar |
| **Notification listener** (Épica 6) | Captura automática, menos fricción para el usuario | Frágil ante cambios de formato del banco, requiere mantenimiento continuo del parser, y expande la superficie de privacidad |

### Qué revisaría si esto crece (más allá de uso personal/hogar)

- La whitelist de `chat_id` dejaría de alcanzar → necesitarías roles/permisos reales.
- El historial de conversación efímero necesitaría aislamiento estricto auditado por usuario, no solo separado por `chat_id`.
- La cola de eventos pasaría de "opcional para notificaciones" a **necesaria** para todo el flujo.
- Los backups pasarían de "cron + prueba manual" a algo con SLA definido y restauración probada regularmente (no una vez).
- El monitoreo pasaría de Uptime Kuma a métricas reales (Prometheus/Grafana), porque con más usuarios ya no puedes detectar degradación "a ojo".
