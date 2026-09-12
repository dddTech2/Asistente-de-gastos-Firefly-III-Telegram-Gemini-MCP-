# Infraestructura — Firefly III (historias 0.1 + 0.2)

Notas operativas del stack base. No es documentación de producto — ver
`docs/plan/` para eso.

## Qué levanta este compose

Tres servicios:

- **`firefly-iii-app`** — imagen oficial `fireflyiii/core`, alcanzable dentro
  de la red Docker (`firefly-iii-app:8080`) y, temporalmente, también en
  `http://localhost:${FIREFLY_HTTP_PORT}` (default `8081`) — ver nota de
  retiro de ese puerto más abajo.
- **`firefly-iii-db`** — MariaDB 11, con volumen nombrado `firefly_iii_db`
  para persistencia real de los datos.
- **`nginx-proxy-manager`** — reverse proxy con HTTPS/Let's Encrypt
  automático delante de Firefly III (historia 0.2).

Redis y el Postgres propio del Bot Service se agregan en la **0.3** — son
servicios e instancias de base de datos **distintas** de esta; no comparten
contenedor con Firefly.

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

Requisito previo: un dominio o subdominio con un registro DNS **A** apuntando
a la IP pública de este servidor. Sin eso, Let's Encrypt no puede emitir el
certificado (usa el challenge HTTP-01, que valida que el dominio realmente
resuelve a este host).

1. Completar `FIREFLY_DOMAIN` en `.env` con ese dominio/subdominio.

2. Levantar/actualizar el stack para que aparezca Nginx Proxy Manager:

   ```bash
   docker compose up -d
   ```

3. Entrar a la UI de administración de NPM: `http://<IP-del-servidor>:81`
   (usuario/clave por defecto la primera vez: `admin@example.com` /
   `changeme` — **cambiarlos apenas entrás**, es lo primero que pide NPM).

4. **Hosts → Proxy Hosts → Add Proxy Host:**
   - Domain Names: el valor de `FIREFLY_DOMAIN`
   - Forward Hostname/IP: `firefly-iii-app` (nombre del servicio, no una IP —
     están en la misma red Docker `firefly-iii-net`)
   - Forward Port: `8080`
   - Pestaña **SSL**: pedir un certificado Let's Encrypt nuevo, activar
     "Force SSL" y "HTTP/2 Support"

5. Confirmar acceso: `https://<FIREFLY_DOMAIN>` sin advertencias de
   certificado, y que `http://<FIREFLY_DOMAIN>` redirige solo a HTTPS.

6. Actualizar `APP_URL=https://<FIREFLY_DOMAIN>` en `.env` y reiniciar:

   ```bash
   docker compose up -d
   ```

7. **Recién ahora**, retirar el mapeo de puerto directo de `firefly-iii-app`
   en `docker-compose.yml` (borrar el bloque `ports:` de ese servicio, queda
   solo accesible vía NPM) y volver a aplicar:

   ```bash
   docker compose up -d
   ```

   Confirmar que `http://<IP-del-servidor>:8081` ya **no** responde desde
   afuera de la red Docker — eso cierra el AC #4 de la historia.

## Fuera de alcance de estas historias

- Redis / Postgres del Bot Service → historia 0.3.
- Backups automáticos → historia 0.4.
- Cron de Firefly III (transacciones recurrentes) y el Data Importer no se
  incluyen todavía — se evalúan si el proyecto los necesita más adelante.
- Centralizar el reverse proxy para los demás proyectos del VPS (Ghost, sitios
  web, mail, etc.) — quedó pendiente de discusión, no forma parte de esta
  historia.
