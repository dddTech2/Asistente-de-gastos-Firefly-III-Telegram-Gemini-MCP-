# MCP de Firefly III (historia 4.1)

Servidor MCP de terceros ([`daften/fireflyiii-mcp`](https://github.com/daften/fireflyiii-mcp),
imagen `ghcr.io/daften/fireflyiii-mcp:0.4.6`, MIT, Node ≥20) desplegado en
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

HTTP. El `CMD` por defecto de la imagen ya es
`node dist/index.js --transport http --host 0.0.0.0` (puerto 3000 por
defecto) — no hace falta pasar `command:` propio en el compose; hacerlo
reemplaza el `CMD` entero en vez de extenderlo y rompe el arranque
(`node: bad option: --transport`, visto en el primer intento de despliegue).

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

## Sesión de pruebas con MCP Inspector (historia 4.2)

Ejercitada con el **cliente CLI** de `@modelcontextprotocol/inspector` (no solo `curl`),
que replica exactamente cómo el Bot Service invocará el MCP en Epic 5: header
`Authorization` por-request, sin ningún token fijado en el propio Inspector.

```bash
npx @modelcontextprotocol/inspector --cli --server-url http://127.0.0.1:${MCP_FIREFLY_PORT:-3100}/mcp \
  --transport http --header "Authorization: Bearer <PAT>" \
  --method tools/list --format json
```

- **Conexión y catálogo (AC #1-#3):** el handshake conecta sin errores; `tools/list`
  devuelve 140 tools. Catálogo completo clasificado (lectura / escritura / automatización
  / destructivas) en [`tools-inventory.md`](./tools-inventory.md) — es el insumo directo
  de la historia 4.3 (decide qué requiere confirmación explícita).
- **Lectura + escritura (AC #4):** `get_accounts` (lectura) y `create_transaction`
  (escritura) ejecutados con el PAT del usuario de prueba A contra la cuenta real
  `id: "1"` — la transacción quedó creada en Firefly III (`id: "4"`). Detalle en
  `tools-inventory.md`.
- **Aislamiento (AC #5):** el mismo `get_accounts`, con el PAT de un segundo usuario de
  prueba, devolvió `"data": [], "total": 0` — mismo patrón de aislamiento por-request que
  4.1, ahora confirmado a través del protocolo MCP completo (Inspector), no solo `curl`.
- **Manejo de errores:** una tool inexistente devuelve un error JSON-RPC legible sin
  crashear el servidor (`tool_not_found`, exit code 5 en el CLI); un PAT inválido/vacío
  devuelve `isError: true` con el error de autenticación de Firefly III reenviado tal
  cual — sin fallback a ningún token fijo.

## Clasificación irreversible/reversible y confirmación en el chat (historia 4.3)

El MCP sigue exponiendo el catálogo **completo** de 140 tools sin ninguna restricción a
nivel de protocolo (AC #2) — no hay allowlist ni preset aplicado en `mcp-firefly`. En su
lugar, la barrera de seguridad vive en el **Bot Service**, determinística en código, no
en el prompt de un modelo:

- `bot-service/src/mcp/toolClassification.ts` — clasifica cada tool call como
  `"irreversible"` o `"reversible"` (código = fuente de verdad; ver el archivo para el
  detalle completo). Resumen del criterio:
  - **Irreversible:** las 16 tools `delete_*`; las 3 tools `trigger_*`
    (`trigger_rule`, `trigger_rule_group`, `trigger_recurrence` — ejecutan una regla o
    recurrencia ya configurada cuyo efecto real el MCP no puede anticipar, puede incluir
    borrados en cascada); `update_transaction`/`bulk_update_transactions` **solo** cuando
    el argumento marca `reconciled: true` (Firefly III no tiene una tool de
    reconciliación separada); y, por fail-safe, cualquier tool que no esté en el
    catálogo conocido de 140 (mismo criterio fail-safe que `credential-resolver.ts` de
    la historia 1.5: mejor pedir confirmación de más que ejecutar sin control una tool
    nueva no auditada).
  - **Reversible:** todo lo demás — las 84 tools de lectura, y las 36 restantes de
    creación/edición (`create_*`, `update_*` sin reconciliar, `upload_attachment`,
    `enable/disable_currency`, `set_primary_currency`).
- `bot-service/src/mcp/confirmacionAccionIrreversible.ts` — antes de ejecutar una tool
  call clasificada como irreversible, envía un mensaje al chat con botones inline ("✅ Sí,
  confirmar" / "❌ Cancelar") describiendo la acción en lenguaje humano (nunca el JSON
  crudo de la tool ni el PAT); la tool solo se invoca si el usuario confirma con el
  botón — cancelar, ignorar, o cualquier otra cosa nunca la ejecuta.
- Ambos módulos están probados con tests unitarios (`bot-service/tests/mcp/`, cliente MCP
  mockeado, sin pegarle a un MCP real) y aún no están conectados a un flujo real de
  tool-calling — eso lo cablea Epic 5 (integración con Gemini), que debe invocar
  `clasificarToolCall` antes de ejecutar cualquier tool y, si el resultado es
  `"irreversible"`, pasar por `solicitarConfirmacion` en vez de ejecutar directo.
