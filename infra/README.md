# Infraestructura — Firefly III (historias 0.1 + 0.2)

Notas operativas del stack base. No es documentación de producto — ver
`docs/plan/` para eso.

## Qué levanta este compose

Dos servicios:

- **`firefly-iii-app`** — imagen oficial `fireflyiii/core`, alcanzable dentro
  de la red Docker (`firefly-iii-app:8080`) y en `127.0.0.1:${FIREFLY_HTTP_PORT}`
  (default `8081`) — **solo en localhost**, no en `0.0.0.0`. Quien lo expone al
  público es el nginx del sistema operativo (fuera de este compose), no un
  contenedor.
- **`firefly-iii-db`** — MariaDB 11, con volumen nombrado `firefly_iii_db`
  para persistencia real de los datos.

Redis y el Postgres propio del Bot Service (historia 0.3) — instancias
**distintas** de la de Firefly, sin compartir contenedor ni volumen:

- **`bot-postgres`** — Postgres 16, volumen nombrado `bot_postgres_data`.
  Guardará `usuarios_autorizados` (Épica 1, PAT cifrado) y `log_auditoria_ia`
  (Épica 8) — ninguna tabla se crea todavía en esta historia, solo el
  contenedor y la conectividad.
- **`bot-redis`** — Redis 7, volumen nombrado `bot_redis_data`. Sin uso
  todavía: servirá para el historial de conversación con TTL corto (Épica 5)
  y la cola BullMQ (Épica 6).

Ambos publicados **solo en `127.0.0.1`** (nunca `0.0.0.0`) porque el Bot
Service es un proceso `pm2` en el host (historias 2.1+), no un contenedor de
este compose — necesita alcanzarlos por `localhost`, igual que el patrón ya
usado para Firefly en el paso 5 de la sección de reverse proxy más abajo.

**Nota sobre el reverse proxy (historia 0.2):** esta VPS ya aloja ~10
proyectos previos y los puertos 80/443 pertenecen a un **nginx instalado
directo en el sistema operativo** (no un contenedor Docker) — es el mismo
patrón que ya usa `nyoholding-contact-api` (bindeado a `127.0.0.1:8000` y
expuesto por ese nginx). Firefly sigue exactamente ese patrón: no se levanta
ningún reverse proxy nuevo en Docker.

- **`mcp-firefly`** (historia 4.1) — servidor MCP de Firefly III de terceros
  (`daften/fireflyiii-mcp`, imagen `ghcr.io/daften/fireflyiii-mcp:v0.4.6`).
  Segundo candidato evaluado: el primero (`@firefly-iii-mcp/server`) se
  descartó por ignorar las credenciales por-header pese a documentarlas —
  ver `mcp/README.md` y el Dev Agent Record de la historia 4.1 para el
  detalle de ambas verificaciones. Este sí implementa credenciales
  por-request de verdad (confirmado en su código fuente): sin PAT fijo,
  cada llamada trae el suyo por header `Authorization`. Publicado solo en
  `127.0.0.1:${MCP_FIREFLY_PORT}` (default 3100), consumido por el Bot
  Service (Épica 5) — nunca expuesto a Internet.

## Por qué MariaDB y no Postgres acá

Firefly III recomienda oficialmente MariaDB. El diseño v2 del proyecto usa
Postgres para el Bot Service (historia 0.3), pero esa es una base de datos
completamente separada con otro propósito (usuarios/PAT/auditoría, no datos
financieros). Ver Dev Notes de la historia `0.1.firefly-docker-compose` para
el detalle de esta decisión.

## Cómo levantarlo

```bash
cd infra
cp .env.example .env
```

1. Generar `APP_KEY` (Laravel, exactamente 32 caracteres o `base64:` + 44):

   ```bash
   docker run --rm fireflyiii/core:latest artisan key:generate --show
   ```

   Pegar el resultado en `APP_KEY=` dentro de `.env`.

2. Completar `DB_PASSWORD` en `.env` con un password fuerte.

3. Levantar el stack:

   ```bash
   docker compose up -d
   ```

4. Abrir `http://localhost:8081` (o el puerto que hayas configurado) y
   completar el wizard de instalación: crear el usuario administrador.

5. Generar un Personal Access Token de validación desde `/profile` una vez
   logueado — confirma que la API responde (`GET /api/v1/about` con el PAT
   como Bearer token).

## Validar persistencia

```bash
docker compose down
docker compose up -d
```

El usuario admin y cualquier dato creado antes deben seguir presentes — los
datos viven en el volumen nombrado `firefly_iii_db`, no en el contenedor.

## Reverse proxy con HTTPS (historia 0.2)

Requisito previo: un dominio/subdominio con registro DNS **A** apuntando a la
IP pública de este servidor (`firefly.nyoholding.com` ya está confirmado).

**⚠️ Orden importante para no perder acceso a mitad de camino:** hasta este
punto Firefly sigue alcanzable en `http://<IP-del-servidor>:8081` (publicado
en `0.0.0.0`). Los pasos 1-4 de abajo se hacen **sin tocar el `docker-compose.yml`
de este repo todavía** — recién en el paso 5 se aplica el cambio a
`127.0.0.1` que ya está en este archivo.

1. Crear el server block en el nginx del sistema (mismo directorio/patrón que
   ya usás para tus otros sitios — confirmar rutas exactas: `/etc/nginx/sites-available/`
   + symlink en `sites-enabled/`, o `/etc/nginx/conf.d/` si ese es tu patrón real):

   ```nginx
   # /etc/nginx/sites-available/firefly.nyoholding.com
   server {
       listen 80;
       server_name firefly.nyoholding.com;

       location / {
           proxy_pass http://127.0.0.1:8081;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   ```bash
   sudo ln -s /etc/nginx/sites-available/firefly.nyoholding.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

   En este punto `http://firefly.nyoholding.com` ya debería responder (todavía
   sin HTTPS) mientras `http://<IP>:8081` sigue funcionando en paralelo.

2. Emitir el certificado con certbot (asume el plugin de nginx, que suele
   editar el server block automáticamente para agregar el bloque 443 +
   redirect — confirmar que sea el mismo método usado en tus otros dominios):

   ```bash
   sudo certbot --nginx -d firefly.nyoholding.com
   ```

3. Confirmar acceso: `https://firefly.nyoholding.com` sin advertencias de
   certificado, y que `http://firefly.nyoholding.com` redirige a HTTPS
   (certbot con `--nginx` agrega el redirect automáticamente).

4. Actualizar `APP_URL=https://firefly.nyoholding.com` en el `.env` de este
   repo y reiniciar Firefly:

   ```bash
   docker compose up -d
   ```

5. **Recién ahora**, con HTTPS confirmado funcionando: traer el
   `docker-compose.yml` actualizado del repo (ya bindea `127.0.0.1:8081` en
   vez de `0.0.0.0:8081`) y volver a aplicar:

   ```bash
   git pull
   docker compose up -d
   ```

   Confirmar que `http://<IP-del-servidor>:8081` ya **no** responde desde
   afuera del servidor (solo vía `https://firefly.nyoholding.com`) — eso
   cierra el AC #4 de la historia.

6. Verificar la renovación automática de certbot (normalmente un timer/cron
   ya instalado en el sistema, compartido por todos los dominios de esta
   VPS — no hace falta configurar nada nuevo por Firefly):

   ```bash
   sudo certbot renew --dry-run
   ```

## Postgres y Redis del Bot Service (historia 0.3)

Requiere completar en `.env`: `BOT_DB_DATABASE`, `BOT_DB_USERNAME`,
`BOT_DB_PASSWORD`, `BOT_DB_PORT` (default `5433`), `BOT_REDIS_PORT` (default
`6380`) — puertos no estándar a propósito, para no chocar con otro
Postgres/Redis que ya pueda existir en esta VPS (~10 proyectos previos).

```bash
docker compose up -d bot-postgres bot-redis
```

Validar conectividad (AC #1, #2) desde el propio host, ya que el Bot Service
también corre ahí:

```bash
# Requiere psql/redis-cli instalados en el host, o usar un contenedor auxiliar:
docker run --rm --network firefly-iii-net postgres:16-alpine \
  psql "postgresql://<BOT_DB_USERNAME>:<BOT_DB_PASSWORD>@bot-postgres:5432/<BOT_DB_DATABASE>" -c "select 1;"

docker run --rm --network firefly-iii-net redis:7-alpine \
  redis-cli -h bot-redis ping
```

Confirmar que **no** son alcanzables desde fuera del servidor (AC #5) —
`telnet <IP-pública> 5433` (o el puerto elegido) debe fallar/colgarse, a
diferencia de un `telnet 127.0.0.1 5433` corrido dentro de la VPS.

Persistencia (AC #4): `docker compose down && docker compose up -d` y
confirmar que un dato de prueba insertado antes sigue en `bot-postgres` — el
volumen `bot_postgres_data` es independiente del contenedor.

Completar también en `bot-service/.env` (no en este `.env` de `infra/`):
`DATABASE_URL` y `REDIS_URL` apuntando a `127.0.0.1:<mismo puerto>` con las
mismas credenciales — es un proceso separado (pm2, fuera de Docker) que lee
su propia configuración. Ver `bot-service/.env.example`.

Esta historia **no** crea ninguna tabla ni usa Redis todavía — solo deja la
infraestructura y la conectividad listas. El esquema de `usuarios_autorizados`
es la historia 1.1.

## Fuera de alcance de estas historias

- Backups automáticos → historia 0.4.
- Cron de Firefly III (transacciones recurrentes) y el Data Importer no se
  incluyen todavía — se evalúan si el proyecto los necesita más adelante.
- Centralizar el reverse proxy para los demás proyectos del VPS (Ghost, sitios
  web, mail, etc.) — quedó pendiente de discusión, no forma parte de esta
  historia.
