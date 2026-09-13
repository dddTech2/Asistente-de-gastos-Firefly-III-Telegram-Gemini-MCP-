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
cp .env.example .env   # completar TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_URL, DATABASE_URL
npm run migrate         # crea usuarios_autorizados (historia 1.1) -- ver más abajo
npm run build
pm2 start dist/index.js --name bot-service
pm2 save
```

`DATABASE_URL`/`REDIS_URL` apuntan al Postgres/Redis de la historia 0.3 (mismas
credenciales/puertos que `infra/.env`) — sin `DATABASE_URL` el proceso no
arranca (ver sección de whitelist más abajo).

> **pm2 corre `dist/index.js` compilado, no el código fuente.** Cualquier
> `git pull` que toque código de `src/` requiere `npm run build` **antes**
> de `pm2 restart bot-service` — si no, pm2 sigue corriendo el JS viejo sin
> avisar que hay una versión más nueva disponible (así se detectó recién en
> el ciclo de despliegue de la historia 3.1).

> **Un commit local no le sirve de nada a la VPS si no se pushea.** `git pull`
> en la VPS solo trae lo que ya está en `origin/master` — un commit hecho y
> nunca pusheado deja el `git pull` sin nada nuevo que traer, y el síntoma se
> confunde fácilmente con el problema de arriba (falta de `npm run build`).
> Verificar con `git status --porcelain=v1 -b` (buscar `ahead N`) antes de
> asumir que el deploy debería tener el cambio (detectado en el ciclo de
> despliegue de la historia 3.2).

```bash
cd /opt/Asistente-de-gastos-Firefly-III-Telegram-Gemini-MCP-/bot-service
git pull
npm install       # solo si cambiaron dependencias
npm run build
pm2 restart bot-service
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
registrado como JSON estructurado en el log del proceso (`src/lib/logger.ts`,
historia 8.1).

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

## Whitelist de chat_id (historia 1.1)

El bot solo responde a `chat_id` de Telegram dados de alta y activos en la
tabla `usuarios_autorizados` (Postgres dedicado de la historia 0.3). Es lo
**primero** que corre en el pipeline de grammY (`bot.use(...)` antes que
`registerEchoHandler` en `src/webhook/telegramWebhook.ts`) — un `chat_id` no
autorizado nunca llega al eco ni a ninguna lógica futura (Firefly/Gemini/MCP).

**Aplicar la migración** (una sola tabla, sin `pat_cifrado` todavía — eso es
la historia 1.4) contra el Postgres de la 0.3:

```bash
cd bot-service
npm run migrate
```

Lee todos los `.sql` de `src/db/migrations/` en orden y los aplica contra
`DATABASE_URL`. Es seguro correrlo más de una vez (cada archivo usa
`CREATE TABLE IF NOT EXISTS`).

**Dar de alta el primer chat_id** (el tuyo) — usá el `INSERT` manual de abajo
para tu propio `chat_id` (o el flujo real de la historia 1.3 si ya está
desplegado, ver más abajo). Tu `chat_id` lo podés ver hablándole a
[@userinfobot](https://t.me/userinfobot) en Telegram:

Si tenés `psql` instalado en el host:

```bash
psql "$DATABASE_URL" -c "INSERT INTO usuarios_autorizados (chat_id, activo) VALUES (<tu_chat_id>, true);"
```

Si no (caso típico de una VPS sin cliente Postgres en el host), corré `psql` desde
adentro del propio contenedor `bot-postgres`:

```bash
docker exec -it bot-postgres bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "INSERT INTO usuarios_autorizados (chat_id, activo) VALUES (<tu_chat_id>, true);"'
```

**Comportamiento:**
- `chat_id` no registrado, o registrado con `activo = false` → el bot responde
  "No autorizado. Este bot es de uso privado." y no ejecuta nada más para ese
  mensaje (ni el eco, ni nada futuro).
- `chat_id` registrado y activo → el mensaje sigue normalmente hacia el resto
  del pipeline.
- Si Postgres no responde (`DATABASE_URL` mal configurado, servicio caído),
  el middleware **falla cerrado**: niega el acceso en vez de dejarlo pasar —
  el aislamiento entre usuarios es el requisito no funcional más crítico del
  proyecto, así que un fallo de infraestructura nunca debe traducirse en
  acceso no controlado.
- Cada intento (autorizado o no) queda logueado con `chat_id` + resultado —
  nunca el texto del mensaje ni datos de otros usuarios.

`DATABASE_URL` es ahora una variable **requerida**: el proceso no arranca sin
ella (`src/config/env.ts`), consistente con que la whitelist es la primera
barrera de seguridad, no algo opcional.

## Alta de usuarios nuevos (historia 1.3)

Flujo controlado para dar de alta un usuario nuevo del bot, vía CLI que corre
el propio administrador (no hay comando de Telegram para esto — evita que un
usuario no autorizado pueda darse de alta a sí mismo). Variante **semi-manual**,
confirmada por el spike 1.2: Firefly III no tiene forma de generar el PAT de
otro usuario vía API admin, así que el usuario debe generarlo él mismo.

Requiere en `.env` (solo para este script, el proceso del bot no los usa):

```
FIREFLY_ADMIN_BASE_URL=https://firefly.nyoholding.com
FIREFLY_ADMIN_TOKEN=<PAT owner, nunca commitear>
```

**Paso 1 — crear la cuenta y habilitar el chat_id:**

```bash
npm run alta-usuario -- crear --nombre "Nombre Apellido" --email usuario@ejemplo.com --chat-id <chat_id> --admin <tu_usuario>
```

Crea la cuenta en Firefly III (`POST /api/v1/users`, sin rol `owner`) y, solo
si eso tuvo éxito, registra el `chat_id` en `usuarios_autorizados` con
`activo = true` — el usuario queda habilitado por la whitelist de 1.1 de
inmediato, antes incluso de tener su PAT. El comando imprime las instrucciones
a transmitirle al usuario (entrar a `/profile` → OAuth → Personal Access
Tokens y generarse uno).

**Paso 2 — una vez que el usuario entrega su PAT:**

```bash
npm run alta-usuario -- completar-pat --chat-id <chat_id> --pat <PAT_del_usuario> --admin <tu_usuario>
```

Este paso cifra el PAT (AES-256-GCM, historia 1.4) y lo guarda en
`usuarios_autorizados.pat_cifrado` — ver la sección siguiente.

Si el `chat_id` ya está registrado, el comando falla explícitamente (no es
idempotente) — evita crear una segunda cuenta Firefly por error.

## PAT cifrado en Postgres (historia 1.4)

El PAT de cada usuario nunca se guarda en texto plano. `completar-pat` (arriba)
lo cifra con **AES-256-GCM** antes del `INSERT`/`UPDATE`; una inspección directa
de la fila en Postgres solo muestra el ciphertext.

Formato almacenado en `pat_cifrado` (columna `TEXT`, migración `0002`):

```
<iv-base64>.<authTag-base64>.<ciphertext-base64>
```

Un único campo alcanza para los metadatos que exige GCM (nonce + tag de
autenticación) sin sumar columnas extra. `NULL` significa "usuario dado de
alta pero sin PAT entregado todavía" (entre el paso 1 y el paso 2 del alta).

Requiere en `.env` (esta sí la usa el proceso principal del bot — falla al
arrancar si falta o tiene el largo incorrecto):

```
PAT_ENCRYPTION_KEY=<32 bytes en hex, ej: openssl rand -hex 32>
```

La clave vive solo en el `.env` del servidor — nunca en el repo, nunca en un
chat. Si se pierde o rota sin re-cifrar los PAT existentes, quedan
indescifrables (rotación de secretos: historia futura de Epic 8, HU-33, fuera
de alcance acá).

`src/auth/pat-crypto.ts` expone `cifrarPat`/`descifrarPat`/`decodificarClaveCifrado`
(puro, sin tocar la base de datos); `usuarios.repository.ts` los usa en
`guardarPatCifrado(chatId, pat)` y `obtenerPatDescifrado(chatId)` — esta última
devuelve el PAT en texto plano únicamente en memoria, para uso inmediato de la
capa que lo necesite (historia 1.5). Ningún log de la aplicación incluye el PAT
ni el valor cifrado.

## Credenciales por-request para el MCP (historia 1.5)

Cada llamada al MCP de Firefly III debe usar el PAT del usuario que escribió
el mensaje — nunca un token compartido ni cacheado entre usuarios. Ese
aislamiento es el requisito de seguridad más crítico del proyecto: una sola
instancia de Firefly III sirve a los ~50 usuarios, y la barrera entre ellos
la pone Firefly III mismo al recibir el PAT correcto en cada request, no
lógica custom de este repo.

`src/auth/credential-resolver.ts` expone `createCredentialResolver({
usuariosRepository, fireflyUrl })`, cuyo `getUserCredentials(chatId)`:

- resuelve y descifra el PAT del `chat_id` (vía `obtenerPatDescifrado` de
  1.4) en cada llamada, sin cachear ni reutilizar nada entre invocaciones;
- devuelve `{ pat, fireflyUrl }`, listo para el header
  `Authorization: Bearer <pat>` contra la instancia de Firefly III;
- si no hay PAT válido (usuario no aprovisionado, PAT corrupto, o cualquier
  fallo al resolverlo) lanza `CredencialesNoDisponiblesError` **antes** de
  que el llamador pueda invocar ninguna tool del MCP — nunca hace fallback a
  un PAT de otro usuario o compartido.

Este es el único punto de resolución de credenciales que debe usarse en todo
el pipeline. El servidor MCP real todavía no está desplegado (Epic 4) ni
existe la integración con Gemini (Epic 5): esta historia construye y prueba
el mecanismo de forma aislada, con el cliente MCP mockeado en los tests —
Epic 4/5 deben llamar a `getUserCredentials` antes de cualquier invocación de
tool, en vez de reimplementar resolución de credenciales en otro lugar.

## Comando `/gasto` (historia 3.1)

Primer camino real Telegram → Firefly III, **sin IA todavía** (Epic 3): valida
el pipeline de punta a punta antes de meter MCP (Epic 4) y Gemini (Epic 5).
Usa el PAT **propio del desarrollador** por variable de entorno — todavía no
hay resolución de PAT por-usuario acá (eso llega cuando Epic 4 conecte el
`credential-resolver.ts` de la historia 1.5).

```
/gasto <monto> <concepto>
/gasto 20000 almuerzo
```

Requiere en `.env` (SÍ los usa el proceso principal — el bot no arranca sin
ellos):

```
FIREFLY_PAT=<tu PAT personal, generado en /profile → OAuth>
FIREFLY_BASE_URL=https://firefly.nyoholding.com
FIREFLY_SOURCE_ACCOUNT=<nombre exacto de una cuenta de activo existente, ej. "Efectivo">
```

`FIREFLY_SOURCE_ACCOUNT` no está en ningún documento de la historia — Firefly
III exige una cuenta de activo como origen de cualquier `withdrawal`, así que
hace falta indicar cuál usar. `src/services/firefly-client.ts` arma la
transacción con `type: "withdrawal"`, `source_name` (esa cuenta) y
`destination_name` = el concepto (Firefly crea/reutiliza la cuenta de gasto
con ese nombre automáticamente).

Comportamiento:

- Monto no numérico, cero/negativo, o sin concepto → responde el mensaje de
  uso, **nunca** llama a Firefly III.
- Éxito → confirma monto, concepto e id de la transacción creada.
- Cualquier error de Firefly III (401, 422, timeout, caído) → mensaje
  genérico al usuario ("No se pudo registrar el gasto..."), nunca expone el
  status HTTP ni ningún detalle técnico; el error real se loggea (`chat_id` +
  `err`, nunca el PAT).
- No interpreta separadores de miles: `20.000` se lee como `20`, no como
  veinte mil — usar el formato plano del ejemplo de arriba.

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
