# MCP de Firefly III (historia 4.1)

Servidor MCP de terceros ([`daften/fireflyiii-mcp`](https://github.com/daften/fireflyiii-mcp),
imagen `ghcr.io/daften/fireflyiii-mcp:v0.4.6`, MIT, Node ≥20) desplegado en
modo **multi-tenant por-request**: sin PAT propio fijado en el contenedor —
cada llamada trae el PAT del usuario que la origina. Es la pieza que hace
viable servir a los ~50 usuarios desde un solo servicio, dejando el
aislamiento de datos en manos de Firefly III (que ya lo hace por `user_id`),
no de lógica custom.

## ⚠️ Primer candidato descartado

Antes de este, se evaluó `@firefly-iii-mcp/server` (v1.4.0) y se descartó:
pese a documentar un modo "por header", su código real usa siempre el
PAT/URL fijados al arrancar el contenedor — confirmado empíricamente
sirviendo una cuenta real de producción con headers de `Authorization`/
`X-Firefly-III-Url` inválidos. Detalle completo en el Dev Agent Record de
`bmad-output/stories/4.1.mcp-multitenant-deploy.story.md` y en
`decision-log.md`. `daften/fireflyiii-mcp` se verificó con el mismo rigor
(código fuente, no solo README) antes de adoptarlo — ver más abajo.

## Contrato de headers (para quien consuma este MCP — Epic 5)

| Header | Valor |
|---|---|
| `Authorization` | `Bearer <PAT del usuario>` — el PAT propio del `chat_id` que originó el mensaje, nunca uno compartido |

La URL de Firefly III **no** viaja por header en este candidato — es fija a
nivel de contenedor (`FIREFLY_URL`, apuntando a la instancia interna de
Docker), porque en este proyecto hay una única instancia Firefly III
compartida por todos los usuarios (Épica 0, arquitectura "Opción B"). Lo que
varía por usuario es solo el PAT.

Sin el header `Authorization` (o con un PAT inválido), Firefly III rechaza
la request con su propio error de autenticación — no hay PAT por defecto al
cual caer (modo "PAT-only": el servicio arranca sin
`FIREFLY_OAUTH_CLIENT_ID`, lo que desactiva el flujo OAuth y exige Bearer
token en cada llamada).

## Verificación del patrón por-request (AC #1)

Confirmado leyendo el código fuente del proyecto (no solo su documentación,
tras el error con el primer candidato):

- `src/http.ts`: extrae el token del header `Authorization: Bearer <token>`
  en cada request y lo guarda en `AsyncLocalStorage` para esa request.
- `src/client.ts`: `FireflyClient` recibe un `tokenResolver` (función, no
  string fijo) y lo invoca en cada llamada HTTP a Firefly III.
- `src/index.ts`: el resolver pasado al cliente HTTP es
  `() => requestContext.getStore().token` — lee el token de la request en
  curso, no un valor global. El modo `stdio` (para clientes locales tipo
  Claude Desktop) sí usa un token fijo, pero ese modo no se usa acá.

## Transporte

HTTP (`--transport http`). Puerto interno del contenedor: `3000` (por eso
`--host 0.0.0.0` en el `command` — el default del binario es `127.0.0.1`,
que no sería alcanzable desde fuera del contenedor).

## Despliegue

Servicio `mcp-firefly` en `infra/docker-compose.yml`, mismo patrón que
`bot-postgres`/`bot-redis`: publicado **solo en `127.0.0.1`** (nunca
`0.0.0.0`) — el Bot Service (proceso pm2 en el host) lo alcanza por
`localhost:${MCP_FIREFLY_PORT}`, sin exponerlo a Internet.

```bash
cd infra
docker compose up -d mcp-firefly
```

**Variables de entorno relevantes:**
- `FIREFLY_URL` — fija, interna (`http://firefly-iii-app:8080` por defecto,
  mismo Docker network) — la URL pública de Firefly III no hace falta acá.
- `MCP_FIREFLY_PORT` — puerto de publicación en el host (default 3100,
  documentado en `infra/.env.example`).
- **A propósito NO hay** `FIREFLY_OAUTH_CLIENT_ID` ni ningún PAT — fijar un
  PAT acá volvería el servicio mono-tenant.

## Verificación de aislamiento (AC #3, #4, #5 de la historia 4.1)

Handshake MCP (`initialize` → `tools/list` → `tools/call`) igual que
cualquier servidor MCP HTTP+SSE. Ejemplo mínimo:

```bash
curl -s -m 10 http://127.0.0.1:${MCP_FIREFLY_PORT:-3100}/mcp \
  -H "Authorization: Bearer <PAT_USUARIO_A>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Tomar el `mcp-session-id` de la respuesta, listar tools con `tools/list`, y
llamar una tool de solo lectura (ej. la de listar cuentas) con ese
`mcp-session-id` + el PAT de A. Repetir todo con el PAT de B y confirmar que
la respuesta cambia (cuentas de B, no de A) — igual que se hizo para
descartar el primer candidato, pero esta vez esperando que SÍ cambie.
Después `docker logs mcp-firefly` para confirmar que ningún PAT quedó en
texto plano.
