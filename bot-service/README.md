# Bot Service — Telegram (historia 2.1)

Esqueleto del bot: recibe updates de Telegram vía webhook HTTPS y los valida.
Todavía no responde nada (eso es la historia 2.2) — esta historia solo deja el
"tubo" armado: BotFather → webhook registrado → secret_token validado.

## Stack

Node.js + TypeScript, **grammY** para la API de Telegram, **Express** como
servidor HTTP. [Source: docs/plan/backlog-plan-implementacion.md#1-stack-tecnológico-recomendado]

## Qué valida cada request entrante

Telegram no acepta el webhook solo por conocer la URL: además hay que
configurar un `secret_token` propio en `setWebhook`, y Telegram lo reenvía en
cada request en el header `X-Telegram-Bot-Api-Secret-Token`. El middleware
`src/webhook/verifySecretToken.ts` compara ese header contra el valor
configurado y corta con `401` si no coincide o falta.

## Cómo correrlo localmente

```bash
cd bot-service
npm install
cp .env.example .env
```

Completar en `.env`:
- `TELEGRAM_BOT_TOKEN` — token real de `@BotFather` (ver abajo).
- `TELEGRAM_WEBHOOK_SECRET` — generar con `openssl rand -hex 32`.

```bash
npm run dev
```

## Tests

```bash
npm test
```

Cubre el middleware `verifySecretToken` (header ausente, incorrecto, correcto)
— es la única lógica con valor en probar como unit test en esta historia; el
resto (registro real del webhook) se verifica contra la API real de Telegram.

## 1. Crear el bot en BotFather (AC #1)

1. Hablar con [@BotFather](https://t.me/BotFather) en Telegram.
2. `/newbot` → elegir nombre y username (debe terminar en `bot`).
3. BotFather devuelve el token — pegarlo en `TELEGRAM_BOT_TOKEN` dentro de
   `.env` en el servidor. **Nunca** en el código ni en un commit.

## 2. Desplegar el Bot Service en la VPS

Esta VPS ya expone otros servicios Node de la misma forma (ver
`nyoholding-contact-api`, bindeado a `127.0.0.1` y expuesto por el nginx del
sistema operativo — mismo patrón usado para Firefly III en la historia 0.2).
El Bot Service sigue exactamente ese patrón: **no se dockeriza** en esta
historia (no toca `infra/docker-compose.yml`), corre como proceso Node
directo (con `pm2` o el gestor de procesos que ya uses para `contact-api`).

```bash
cd /opt/Asistente-de-gastos-Firefly-III-Telegram-Gemini-MCP-/bot-service
npm install
cp .env.example .env   # completar TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_URL
npm run build
pm2 start dist/index.js --name bot-service
pm2 save
```

`PORT` en `.env` default `3001` — usar el mismo puerto en el server block de
nginx del paso 3. Ajustar si `3001` ya está ocupado por otro proyecto de la VPS.

## 3. Reverse proxy + HTTPS para el webhook (AC #2)

Necesita su **propio subdominio** (Firefly ya ocupa `firefly.nyoholding.com`
por completo). Se usó `bot.firefly.nyoholding.com`. Mismo patrón que la
historia 0.2:

1. Crear el registro DNS **A** de `bot.firefly.nyoholding.com` → IP de esta VPS.

2. Server block en el nginx del sistema:

   ```nginx
   # /etc/nginx/sites-available/bot.firefly.nyoholding.com
   server {
       listen 80;
       server_name bot.firefly.nyoholding.com;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   ```bash
   sudo ln -s /etc/nginx/sites-available/bot.firefly.nyoholding.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. Certificado:

   ```bash
   sudo certbot --nginx -d bot.firefly.nyoholding.com
   ```

4. Confirmar `https://bot.firefly.nyoholding.com` responde (aunque sea con un error de
   Express por falta de ruta `GET /` — lo que importa es que el TLS y el proxy
   ya funcionan).

## 4. Registrar el webhook contra la API de Telegram (AC #3, #5)

Con `PUBLIC_URL=https://bot.firefly.nyoholding.com` ya en `.env`:

```bash
npm run set-webhook
```

El script llama `setWebhook` con la URL pública + el `secret_token`, y después
`getWebhookInfo` para confirmar que quedó registrado sin `last_error_message`
(cierra el AC #5). Volver a correrlo es seguro si ya había un webhook previo —
`setWebhook` simplemente lo reemplaza.

## 5. Verificación final (AC #4)

Un update real de Telegram (o un `curl` simulando uno) sin el header
`X-Telegram-Bot-Api-Secret-Token`, o con un valor incorrecto, debe recibir
`401` y no debe aparecer procesado en los logs del Bot Service:

```bash
curl -i -X POST https://bot.firefly.nyoholding.com/webhook/telegram \
  -H "Content-Type: application/json" \
  -d '{}'
# esperado: 401
```

## Echo de confirmación (historia 2.2)

Cualquier mensaje de texto que le escribas al bot recibe como respuesta
`Recibido: "{texto}"` — confirma que el pipeline completo (Telegram →
webhook → secret_token → handler → `sendMessage`) funciona de punta a punta.
Otros tipos de update (stickers, fotos, etc.) se ignoran sin romper nada:
`bot.on("message:text", ...)` en `src/handlers/echoHandler.ts` solo dispara
para mensajes con texto.

Sin lógica de negocio todavía — no interpreta el mensaje, no toca Firefly III.
Eso empieza en Epic 3 (integración directa) y Epic 5 (lenguaje natural con
Gemini).

## Ack inmediato + procesamiento asíncrono (historia 2.3)

`POST /webhook/telegram` responde `200 OK` a Telegram apenas el `secret_token`
se valida — **antes** de procesar el update (echo u otra lógica futura). El
procesamiento real se desacopla del ciclo request/response con una cola en
memoria (`src/queue/inMemoryProcessingQueue.ts`): FIFO, secuencial, sin
persistencia. Esto evita que Telegram vea un timeout aunque lleguen varios
mensajes al mismo tiempo o el procesamiento tarde.

Es un mecanismo **provisional e in-process**, no la cola persistente (BullMQ +
Redis) de la historia 6.2 — si el proceso se reinicia con items pendientes en
la cola, esos items se pierden. Limitación aceptada al volumen actual (decenas
de mensajes/día); se resuelve en Epic 6.

Un error durante el procesamiento asíncrono de un update no afecta el `200`
que ya se le envió a Telegram (que ya no reintenta ese update) — queda
registrado como JSON estructurado en el log del proceso (`src/logging/logger.ts`,
un logger mínimo con alcance acotado a este caso; el logging estructurado
completo del servicio es la historia 8.1).

## Logs estructurados (historia 8.1)

El Bot Service loggea en JSON (un objeto por línea) a `stdout`/`stderr` vía
[pino](https://getpino.io/) — sin `console.log` de texto libre y sin escribir
a ningún archivo propio, para que `pm2`/Docker lo capturen con su driver de
logging estándar. Ver `src/lib/logger.ts` y `src/config/logging.config.ts`.

Cada línea incluye `timestamp` (ISO 8601), `level`, `msg`, y — cuando aplica —
`chat_id`/`update_id` para poder correlacionar reintentos de Telegram con lo
que el bot realmente procesó. Nunca aparecen en texto plano: el PAT de
Firefly III, la API key de Gemini, el token del bot ni cualquier otro secreto
— se redactan como `"[REDACTED]"` (campos `pat`, `token`, `apiKey`,
`authorization`).

El nivel se controla con `LOG_LEVEL` en `.env` (`debug | info | warn | error`,
default `info`) — cambiar el nivel solo requiere editar `.env` y reiniciar el
proceso, sin rebuild:

```bash
pm2 restart bot-service
pm2 logs bot-service
```

Instrumentado hoy: webhook de Telegram (recibido, encolado, desencolado,
procesado, error) y excepciones/rechazos no controlados a nivel de proceso
(`src/index.ts`). Los clientes de Gemini y del MCP (Epic 4/5) todavía no
existen en el código — cuando se construyan deben loggear con el mismo
`logger` central, no reintroducir `console.log`.

## Fuera de alcance de esta historia

- Deduplicar updates repetidos por `update_id` → historia 6.1.
- Reintentos con backoff ante fallos de Gemini/Firefly → historia 6.4.
- Reemplazar la cola en memoria por una persistente (BullMQ + Redis) → historia 6.2.
- Un agregador de logs centralizado (ELK/Loki/Grafana) → sobre-ingeniería para
  este tamaño; alcanza con `pm2 logs` / el driver de logging de Docker.
- Auditoría de negocio (qué escribió cada usuario, qué tool ejecutó la IA) →
  historia 8.2, tabla en base de datos, no logs de proceso.
- Dockerizar el Bot Service / sumarlo a `infra/docker-compose.yml` → se evalúa
  junto con Redis/Postgres en la historia 0.3, no acá.
