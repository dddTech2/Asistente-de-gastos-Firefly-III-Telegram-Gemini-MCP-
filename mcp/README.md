# MCP de Firefly III (historia 4.1) — BLOQUEADA, NO USAR EN PRODUCCIÓN

> **⚠️ Este servicio NO logra aislamiento multi-tenant.** Verificado
> empíricamente el 2026-09-13: `@firefly-iii-mcp/server` v1.4.0 ignora por
> completo los headers `Authorization`/`X-Firefly-III-Url` de cada request y
> usa siempre el PAT/URL fijados al arrancar el contenedor (confirmado
> mandando headers con basura y recibiendo igual una cuenta real de
> producción). El README público del proyecto upstream promete un modo
> "por-header" que el código de esta versión no implementa. **No desplegar
> este contenedor con un PAT real contra la instancia de producción** — ver
> el Dev Agent Record de `bmad-output/stories/4.1.mcp-multitenant-deploy.story.md`
> para el detalle completo y las alternativas en evaluación.

Lo que sigue describe el diseño **original, invalidado** — se deja como
referencia de qué se intentó y por qué no sirve, no como instrucción de uso.

---

Servidor MCP de terceros ([`@firefly-iii-mcp/server`](https://github.com/etnperlong/firefly-iii-mcp),
v1.4.0) desplegado en modo **multi-tenant por-request**: el contenedor no
tiene fijado ningún PAT ni URL de Firefly III propios — cada llamada trae sus
propias credenciales. Es la pieza que hace viable servir a los ~50 usuarios
desde un solo servicio, dejando el aislamiento de datos en manos de Firefly
III (que ya lo hace por `user_id`), no de lógica custom.

## Contrato de headers (para quien consuma este MCP — Epic 5)

| Header | Valor |
|---|---|
| `Authorization` | `Bearer <PAT del usuario>` — el PAT propio del `chat_id` que originó el mensaje, nunca uno compartido |
| `X-Firefly-III-Url` | URL base de la instancia Firefly III (la misma para todos los usuarios en este proyecto: una sola instancia, Épica 0) |

Sin estos dos headers (o con un PAT inválido), la request no debe devolver
datos de ningún usuario — no hay credencial por defecto a la cual caer.

## Transporte

HTTP (Streamable HTTP + Server-Sent Events), **no stdio** — necesario porque
el Bot Service (proceso pm2 separado, no el mismo proceso que el MCP) le
pega por red, igual que le pega a Firefly III. Puerto interno del contenedor:
`3000`.

## Despliegue

Se agrega como servicio `mcp-firefly` en `infra/docker-compose.yml`, mismo
patrón que `bot-postgres`/`bot-redis`: publicado **solo en `127.0.0.1`**
(nunca `0.0.0.0`) — el Bot Service (proceso host) lo alcanza por
`localhost:${MCP_FIREFLY_PORT}`, sin exponerlo a Internet.

```bash
cd infra
docker compose up -d --build mcp-firefly
```

**Variables de entorno que este servicio deliberadamente NO tiene:**
`FIREFLY_III_PAT`, `FIREFLY_III_BASE_URL` — fijarlas volvería el servicio
mono-tenant (todas las requests usarían ese PAT, ignorando el del usuario
real). El único valor de infra es `MCP_FIREFLY_PORT` (puerto de publicación
en el host), documentado en `infra/.env.example`.

## Verificación de aislamiento (AC #3, #4, #5 de la historia 4.1)

Con dos PATs de prueba de dos cuentas Firefly III distintas (usuario A y B):

```bash
curl -s http://127.0.0.1:${MCP_FIREFLY_PORT:-3100}/mcp \
  -H "Authorization: Bearer <PAT_USUARIO_A>" \
  -H "X-Firefly-III-Url: https://firefly.nyoholding.com" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}'
```

Repetir con el PAT de B y confirmar que la respuesta cambia (datos de B, no
de A). Luego `docker logs mcp-firefly` y confirmar que ningún PAT aparece en
texto plano (por eso el `--logLevel info`, no `debug`, en el `Dockerfile`).

## Desviación de alcance documentada: imagen Docker propia

El proyecto upstream no publica una imagen Docker oficial — solo el paquete
npm. Se agregó `mcp/Dockerfile` (no mencionado en el Owned File/Module Scope
original de la historia) para poder declarar el servicio con `build:` en
`docker-compose.yml`, ya que el AC #2 exige un despliegue vía Docker Compose.
[Inference]
