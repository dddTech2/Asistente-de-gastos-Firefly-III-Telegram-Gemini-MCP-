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

Redis y el Postgres propio del Bot Service se agregan en la **0.3** — son
servicios e instancias de base de datos **distintas** de esta; no comparten
contenedor con Firefly.

**Nota sobre el reverse proxy (historia 0.2):** esta VPS ya aloja ~10
proyectos previos y los puertos 80/443 pertenecen a un **nginx instalado
directo en el sistema operativo** (no un contenedor Docker) — es el mismo
patrón que ya usa `nyoholding-contact-api` (bindeado a `127.0.0.1:8000` y
expuesto por ese nginx). Firefly sigue exactamente ese patrón: no se levanta
ningún reverse proxy nuevo en Docker.

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

## Fuera de alcance de estas historias

- Redis / Postgres del Bot Service → historia 0.3.
- Backups automáticos → historia 0.4.
- Cron de Firefly III (transacciones recurrentes) y el Data Importer no se
  incluyen todavía — se evalúan si el proyecto los necesita más adelante.
- Centralizar el reverse proxy para los demás proyectos del VPS (Ghost, sitios
  web, mail, etc.) — quedó pendiente de discusión, no forma parte de esta
  historia.
