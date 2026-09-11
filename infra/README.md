# Infraestructura — Firefly III (historia 0.1)

Notas operativas del stack base. No es documentación de producto — ver
`docs/plan/` para eso.

## Qué levanta este compose

Dos servicios:

- **`firefly-iii-app`** — imagen oficial `fireflyiii/core`, expuesta en
  `http://localhost:${FIREFLY_HTTP_PORT}` (default `8081`).
- **`firefly-iii-db`** — MariaDB 11, con volumen nombrado `firefly_iii_db`
  para persistencia real de los datos.

HTTPS y reverse proxy se agregan en la historia **0.2**. Redis y el Postgres
propio del Bot Service se agregan en la **0.3** — son servicios e instancias
de base de datos **distintas** de esta; no comparten contenedor con Firefly.

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

## Fuera de alcance de esta historia

- HTTPS / dominio propio → historia 0.2.
- Redis / Postgres del Bot Service → historia 0.3.
- Backups automáticos → historia 0.4.
- Cron de Firefly III (transacciones recurrentes) y el Data Importer no se
  incluyen todavía — se evalúan si el proyecto los necesita más adelante.
