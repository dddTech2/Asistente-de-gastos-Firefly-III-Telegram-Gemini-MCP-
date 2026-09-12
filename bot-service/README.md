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
por completo). Sugerido: `bot.nyoholding.com` — confirmar o ajustar según
disponibilidad. Mismo patrón que la historia 0.2:

1. Crear el registro DNS **A** de `bot.nyoholding.com` → IP de esta VPS.

2. Server block en el nginx del sistema:

   ```nginx
   # /etc/nginx/sites-available/bot.nyoholding.com
   server {
       listen 80;
       server_name bot.nyoholding.com;

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
   sudo ln -s /etc/nginx/sites-available/bot.nyoholding.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. Certificado:

   ```bash
   sudo certbot --nginx -d bot.nyoholding.com
   ```

4. Confirmar `https://bot.nyoholding.com` responde (aunque sea con un error de
   Express por falta de ruta `GET /` — lo que importa es que el TLS y el proxy
   ya funcionan).

## 4. Registrar el webhook contra la API de Telegram (AC #3, #5)

Con `PUBLIC_URL=https://bot.nyoholding.com` ya en `.env`:

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
curl -i -X POST https://bot.nyoholding.com/webhook/telegram \
  -H "Content-Type: application/json" \
  -d '{}'
# esperado: 401
```

## Fuera de alcance de esta historia

- Responder a los mensajes (echo) → historia 2.2.
- Confirmar el webhook a Telegram de forma asíncrona con cola → historia 2.3.
- Dockerizar el Bot Service / sumarlo a `infra/docker-compose.yml` → se evalúa
  junto con Redis/Postgres en la historia 0.3, no acá.
