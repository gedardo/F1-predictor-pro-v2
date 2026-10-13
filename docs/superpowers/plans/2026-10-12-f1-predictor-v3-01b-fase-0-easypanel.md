# Fase 0b — Despliegue directo desde Easypanel con Dockerfile: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Que cada servicio de la app se cree en Easypanel con el flujo estándar —fuente GitHub, **Build Path** de la carpeta del servicio, build **Dockerfile** detectado automáticamente— y quede funcionando sin pasos manuales frágiles: sin editar la URL de la base, sin correr migraciones a mano, sin depender del orden de deploy entre `api` y `web`, y seguro por defecto en producción.

**Arquitectura:** Cada app es autocontenida: `apps/api/Dockerfile` (contexto `apps/api`) y `apps/web/Dockerfile` (contexto `apps/web`, con su configuración de nginx adentro). La imagen de la API arranca con un entrypoint que espera a Postgres, aplica `alembic upgrade head` bajo un advisory lock y después ejecuta el comando. La configuración acepta la URL interna que muestra Easypanel tal cual (`postgres://…?sslmode=disable`). nginx resuelve el upstream de la API en tiempo de request con el DNS de Docker, así que `web` arranca aunque `api` todavía no exista y sobrevive a redeploys de `api`. El CI construye las imágenes exactamente como Easypanel (`docker build <build path>`, variables como build args) y simula un primer deploy.

**Spec:** `docs/propuesta.md` §3 (servicios en Easypanel: `postgres`, `api`, `worker`, `web`) y el pedido del dueño: "la app tiene que estar diseñada para que la pueda implementar desde Easypanel con Dockerfile". Plan maestro §2 y §3.1.

**Hechos de Easypanel (documentación oficial, `easypanel.io/llms-full.txt`, consultada el 2026-10-12):**
- "For repository sources, the Dockerfile path is resolved from the Build Path, and that directory is also the Docker build context. A Dockerfile cannot `COPY` files outside that context."
- "Easypanel currently selects Dockerfile automatically when the Build Path contains a file named `Dockerfile`."
- Easypanel construye con Buildx y "passes project and service environment values, including `GIT_SHA`, as build arguments".
- Las variables admiten `$(PROJECT_NAME)`, `$(SERVICE_NAME)` y `$(PRIMARY_DOMAIN)`.
- Postgres: "internal connection URL with `sslmode=disable`"; el host interno "is derived from the project and service names" (ejemplo de la doc: `project_database`).
- Deploy: réplicas, zero-downtime, Tini como init y "command override". No hay comando de pre-deploy: lo que tenga que correr antes de servir va en la imagen.

## Restricciones globales

- Build Path de `api` = `/apps/api`; Build Path de `web` = `/apps/web`; archivo `Dockerfile` en cada una (detección automática). Nada en `infra/` puede ser necesario para construir una imagen.
- Ninguna imagen declara `ARG` para secretos (Easypanel pasa todas las variables como build args).
- La imagen de la API es segura por defecto: `ENV=prod` salvo que se indique otra cosa; en `prod`, `SECRET_KEY` obligatorio y distinto del placeholder (ya validado).
- La URL de Easypanel se acepta sin editar: `postgres://`, `postgresql://` y `postgresql+asyncpg://`; `sslmode` se traduce para asyncpg.
- Migraciones automáticas al arrancar `api` (variable `RUN_MIGRATIONS`, por defecto `1`; el worker de la Fase 1a usará `0`), con advisory lock para varias réplicas.
- `web` no depende del orden de deploy ni de la IP de `api`.
- Sin volúmenes en el primer deploy (la Fase 0 no los usa); la guía explica el esquema para las Fases 3–4.
- Idioma: guía, mensajes y comentarios en español; identificadores en inglés. `.ps1` en UTF-8 con BOM + CRLF; `.sh` en LF.

## Foco de revisión

1. **Primer deploy con la base vacía y Postgres todavía arrancando:** el entrypoint espera con tope (`DB_WAIT_SECONDS`, 60 s por defecto) y falla con un mensaje claro si no conecta; la migración corre una sola vez. Test T1 + CI.
2. **Dos réplicas arrancando a la vez:** el advisory lock serializa `alembic upgrade head`; la segunda ve la base ya migrada. Test T1.
3. **URL con `sslmode=require` (base externa):** se traduce a `ssl=require`, no se descarta en silencio. Test T1.
4. **`web` desplegado antes que `api`, o `api` redesplegado con otra IP:** `/healthz` responde 200 desde el arranque, `/api/*` devuelve 502 mientras `api` no exista y 200 después, sin reiniciar `web`. CI T2.
5. **Secretos como build args:** el `SECRET_KEY` pasado como `--build-arg` no aparece en `docker history --no-trunc` ni en `docker inspect` de la imagen. CI T1.

---

### Tarea 1: Imagen de la API autocontenida y lista para Easypanel

**Archivos:**
- Mover: `infra/Dockerfile.api` → `apps/api/Dockerfile` (`git mv`)
- Crear: `apps/api/.dockerignore`, `apps/api/docker-entrypoint.sh`, `apps/api/app/db_wait.py`
- Modificar: `apps/api/app/config.py`, `apps/api/alembic/env.py`, `infra/docker-compose.dev.yml` (servicio `api`), `.github/workflows/ci.yml` (job `docker`: build y chequeos de la imagen api; hadolint), `.github/dependabot.yml` (docker en `/apps/api`)
- Tests: `apps/api/tests/test_config.py`, `apps/api/tests/test_db_wait.py`, `apps/api/tests/test_migrations_lock.py`

**Interfaces:**
- `normalize_database_url(url: str) -> str` en `app/config.py` (validador de `database_url`): `postgres://` y `postgresql://` → `postgresql+asyncpg://`; `postgresql+asyncpg://` queda igual; `sslmode=disable|allow|prefer` se quita; `sslmode=require|verify-ca|verify-full` → `ssl=<mismo valor>`; el resto de la query se conserva; usuario, contraseña (con caracteres codificados), host, puerto y base no cambian. Verificar con el código instalado de SQLAlchemy (dialecto asyncpg) y asyncpg que `ssl=<modo>` en la query llega a `asyncpg.connect(ssl=...)`.
- `async def wait_for_db(url: str, timeout_s: float, interval_s: float = 1.0) -> None` en `app/db_wait.py`: reintenta `SELECT 1` hasta el tope; al vencer lanza `TimeoutError` con mensaje en español sin la contraseña. `python -m app.db_wait` lo ejecuta con `settings.database_url` y `DB_WAIT_SECONDS` (default 60) y sale con código 1 y el mensaje si vence.
- `alembic/env.py`: `pg_advisory_lock(<constante>)` antes de `context.run_migrations()` y `pg_advisory_unlock` en `finally`, sobre la misma conexión. La constante va en un módulo compartido (`app/db.py` o `app/migrations_lock.py`) con nombre y comentario.
- `apps/api/docker-entrypoint.sh` (POSIX `sh`, LF, `set -eu`): si `RUN_MIGRATIONS` (default `1`) es `1`, corre `python -m app.db_wait` y `alembic upgrade head`; después `exec "$@"`. Se copia a `/usr/local/bin/docker-entrypoint.sh` (fuera de `/srv`, para que el bind mount de compose no lo tape) con permisos 755.
- `apps/api/Dockerfile`: mismo contenido funcional que `infra/Dockerfile.api` con rutas relativas al nuevo contexto (`COPY pyproject.toml uv.lock ./`, `COPY . ./`), más `ENV ENV=prod`, `ENTRYPOINT ["docker-entrypoint.sh"]`, `CMD` de uvicorn sin cambios y `HEALTHCHECK --start-period=60s --interval=30s --timeout=5s --retries=3`. Sin `ARG` de secretos.
- `apps/api/.dockerignore`: `.venv`, `.env*` (salvo nada: `.env.example` no hace falta en la imagen), `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.dev-mail`, `.fastf1-cache`, `data`, `tests` (los tests no van a la imagen).

**Pasos:**
- [ ] Tests primero (RED): `normalize_database_url` con la URL exacta de Easypanel (`postgres://f1app:p%40ss@f1_postgres:5432/f1?sslmode=disable` → `postgresql+asyncpg://f1app:p%40ss@f1_postgres:5432/f1`), con `sslmode=require` → `ssl=require`, con query extra conservada y con `postgresql+asyncpg://` sin cambios; `Settings(database_url=<url de Easypanel>)` normaliza; `wait_for_db` vence contra un puerto cerrado con `TimeoutError` cuyo mensaje no contiene la contraseña y retorna enseguida contra la base de tests; el lock: con el lock tomado desde otra conexión, `command.upgrade` espera (verificar con un hilo y un timeout corto) y, liberado, termina; después de migrar no quedan advisory locks del proceso.
- [ ] Implementar (GREEN) y `git mv` del Dockerfile; actualizar compose (`build: { context: ../apps/api }`, `environment: ENV: dev`; las migraciones pasan a correr solas al levantar) y el job `docker` del CI: `docker build -t api:ci apps/api` **sin `-f`**, pasando como build args las mismas variables que el job usa en runtime (como hace Easypanel) y verificando que el valor de `SECRET_KEY` no aparece en `docker history --no-trunc api:ci` ni en `docker image inspect api:ci`.
- [ ] Simulación de primer deploy en el job `docker` (reemplaza el arranque manual de migraciones si lo hubiera): Postgres vacío; `api:ci` con `DATABASE_URL=postgres://f1:f1dev@<host>:5432/f1?sslmode=disable` (formato Easypanel), `SECRET_KEY` hex, `ALLOWED_ORIGINS=https://f1.example.test`, **sin** `ENV`; asserts: el contenedor llega a `healthy`, `alembic_version` existe en la base, `/api/health` 200, `/api/docs` 404 (prod). Segunda réplica arrancada en paralelo contra la misma base: ambas `healthy`, una sola fila en `alembic_version`.
- [ ] Verificación local: `uv run pytest -v`, ruff, format, mypy; `sh -n apps/api/docker-entrypoint.sh`; hadolint si está disponible; YAML/actionlint del workflow.
- [ ] Commit: `feat(api): imagen autocontenida para Easypanel con migraciones automáticas y URL de Postgres sin editar`.

### Tarea 2: Imagen web autocontenida e independiente del orden de deploy

**Archivos:**
- Mover: `infra/Dockerfile.web` → `apps/web/Dockerfile`; `infra/nginx/{nginx.conf.template,security-headers.conf,real-ip.conf}` → `apps/web/nginx/`
- Crear: `apps/web/.dockerignore`
- Borrar: `.dockerignore` de la raíz (ya no hay builds con contexto en la raíz; verificar con `grep -rn "infra/Dockerfile\|context: \.\." infra .github` que nada lo use)
- Modificar: `apps/web/nginx/nginx.conf.template`, `.github/workflows/ci.yml` (job `docker`: build y chequeos de web; hadolint; rutas de nginx en los asserts), `.github/dependabot.yml` (docker en `/apps/web`; quitar `/infra`)

**Interfaces:**
- `apps/web/Dockerfile`: mismo contenido funcional, con rutas relativas a `apps/web` (`COPY package.json package-lock.json ./`, `COPY . ./`, `COPY nginx/nginx.conf.template /etc/nginx/nginx.conf.template`, etc.). Sin `ARG` de secretos.
- `apps/web/.dockerignore`: `node_modules`, `dist`, `dev-dist`, `test-results`, `playwright-report`, `.lighthouseci`, `*.log`, `.env*`.
- nginx: en vez de `upstream api { server ${API_UPSTREAM}; }` + `proxy_pass http://api;`, usar `resolver 127.0.0.11 valid=10s ipv6=off;` (DNS embebido de Docker, presente en compose y en Swarm/Easypanel) y, en `location /api/`, `set $api_upstream ${API_UPSTREAM};` + `proxy_pass http://$api_upstream;` (sin URI, para que pase la URI original intacta). `envsubst` sigue limitado a `$API_UPSTREAM`. Mantener cabeceras, `real_ip`, WebSocket y timeouts. Documentar en un comentario por qué hay `resolver` (arranque sin `api` y redeploys con IP nueva).
- `ENV API_UPSTREAM=api:8000` sigue como default (compose); en Easypanel se define `API_UPSTREAM=$(PROJECT_NAME)_api:8000`.

**Pasos:**
- [ ] `git mv` de Dockerfile y nginx; rutas nuevas en el Dockerfile; `.dockerignore`; template con `resolver`.
- [ ] CI job `docker`: `docker build -t web:ci apps/web` sin `-f`; actualizar los asserts que leen la plantilla; agregar el chequeo de **orden de deploy**: arrancar `web:ci` con `API_UPSTREAM` apuntando a un nombre que todavía no existe en la red → `/healthz` 200 y `/api/health` 502 (no 200, no HTML del SPA, con las cabeceras de seguridad); después arrancar un contenedor `api` con ese nombre (alias de red) → dentro de 30 s `/api/health` vía web responde 200 **sin reiniciar web**; luego recrear `api` (nueva IP) y verificar que vuelve a responder 200 sin reiniciar web.
- [ ] Verificación local: `npm run build`, lint, typecheck, tests; crossplane sobre la plantilla renderizada; hadolint si está disponible; YAML/actionlint.
- [ ] Commit: `feat(web): imagen autocontenida en apps/web y upstream de la API resuelto en cada request`.

### Tarea 3: Guía de Easypanel paso a paso y documentación

**Archivos:**
- Reescribir: `infra/easypanel.md`
- Modificar: `README.md`, `CLAUDE.md`, `docs/fase-0-pendientes.md`, `infra/docker-compose.dev.yml` (solo comentarios si hace falta), cualquier otro archivo que todavía mencione `infra/Dockerfile.*`, `infra/nginx/` o migraciones manuales (`grep -rn`)

**Contenido obligatorio de la guía (en español, en este orden):**
1. Requisitos: servidor con Easypanel, VPS ≥ 8 GB RAM recomendado (o generar backfill/replays en la PC local), dominio en Cloudflare, token de GitHub del servidor configurado si el repo es privado.
2. Proyecto `f1`.
3. Servicio Postgres: imagen `postgres:17`, sin Expose; creación del rol `f1app` sin SUPERUSER y dueño de la base (pasos actuales, que ya fueron revisados); backups programados.
4. Servicio App `api`: GitHub `gedardo/f1-predictor-pro`, rama `main`, **Build Path `/apps/api`**, build Dockerfile (detectado; archivo `Dockerfile`). Variables: `DATABASE_URL` = la URL interna de Credentials **pegada tal cual** cambiando solo usuario y contraseña por `f1app` (la app traduce `postgres://` y `sslmode`); `SECRET_KEY` (generar); `ALLOWED_ORIGINS=https://<dominio>`; `SENTRY_DSN` opcional. No hace falta `ENV` (la imagen es `prod`). Sin dominio, sin puertos publicados, sin volúmenes. Recursos 1 GB. Deploy: las migraciones corren solas; dónde verlas en los logs.
5. Servicio App `web`: misma fuente, **Build Path `/apps/web`**, Dockerfile detectado. Variable `API_UPSTREAM=$(PROJECT_NAME)_api:8000` (verificar el formato del host interno comparándolo con el de Postgres en Credentials). Dominio con HTTPS al puerto 80. El orden de deploy entre `api` y `web` no importa.
6. Cloudflare (proxy, SSL Full strict, caché de `/replay/*`, WebSockets) y la verificación obligatoria de IP real detrás de Traefik (contenido actual, revisado).
7. Verificación del deploy: comandos `curl` de `/api/health`, cabeceras y `manifest.webmanifest`.
8. Operación: cada push a `main` + Deploy (o auto-deploy si se activa en el panel) aplica migraciones solas; réplicas seguras por el lock; rotación de secretos; prueba de restauración con `scripts/restore-test.ps1`.
9. Próximas fases: `worker` (misma imagen y Build Path, command override `python -m app.worker`, `RUN_MIGRATIONS=0`; su healthcheck se resuelve en la Fase 1a) y volúmenes de las Fases 3–4 (Bind a una ruta común del servidor para `api`, `worker` y `web`, porque los volúmenes de Easypanel son por servicio según su documentación de backups).
10. Checklist de primer deploy con casillas, actualizado a todo lo anterior.

**Pasos:**
- [ ] Reescribir la guía con los puntos anteriores y verificar cada ruta, variable y puerto contra el repo.
- [ ] README/CLAUDE.md: tabla de servicios con su Build Path; comando de build local equivalente (`docker build apps/api`, `docker build apps/web`); quitar referencias a migraciones manuales.
- [ ] `docs/fase-0-pendientes.md`: marcar como resueltos los ítems de migraciones en el deploy y del upstream de nginx; actualizar el de volúmenes.
- [ ] Commit: `docs(infra): guía de Easypanel con Build Path por servicio, migraciones automáticas y orden de deploy libre`.

## Criterio de "listo"

- [ ] `docker build apps/api` y `docker build apps/web` (sin `-f`, contexto = Build Path) construyen en CI.
- [ ] El job `docker` simula el primer deploy de Easypanel con la URL de Postgres sin editar, sin `ENV`, con dos réplicas y con `web` arrancado antes que `api`, y pasa.
- [ ] Ningún archivo del repo menciona `infra/Dockerfile.*`, `infra/nginx/` ni migraciones manuales en el deploy.
- [ ] CI verde en el PR.
