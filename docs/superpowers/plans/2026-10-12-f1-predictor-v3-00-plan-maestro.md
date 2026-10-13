# F1 Predictor Pro v3 — Plan maestro de desarrollo

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar cada plan de fase tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para seguimiento. Este documento es el índice y las reglas transversales; cada fase tiene su propio plan en esta carpeta.

**Objetivo:** Rehacer F1 Predictor Pro como plataforma completa de F1 (datos 1950→hoy, análisis de sesión, Race Replay web, en vivo y juego validado en el servidor) sobre un backend propio en FastAPI + Postgres, desplegado en Easypanel.

**Arquitectura:** Monorepo nuevo `f1-predictor-pro` con `apps/web` (React 19 + Vite + TS, PWA, servida por nginx) y `apps/api` (FastAPI, SQLAlchemy 2 async, Alembic; la misma imagen corre `api`, `worker` y `live-ingestor`). Postgres 17 en red interna de Easypanel. La telemetría pesada no va a Postgres: replay en chunks binarios servidos por nginx y telemetría completa en Parquet leída con DuckDB. El worker porta la capa de datos de `f1-race-replay` (sin GUI) y corre el scoring automático.

**Stack (versiones verificadas el 2026-10-12):**

| Capa | Paquete | Versión fijada | Nota |
|---|---|---|---|
| Backend | Python | 3.12 | instalado localmente (3.12.10) |
| | fastapi / uvicorn | 0.143 / 0.54 | |
| | sqlalchemy[asyncio] / asyncpg / alembic | 2.1 / 0.32 / 1.20 | |
| | pydantic / pydantic-settings | 2.14 / 2.15 | |
| | **fastf1** | **==3.8.3** (exacta) | usa API privada `_extended_timing_data`; se cubre con test de contrato |
| | pandas / numpy / scipy | `>=2.2,<3` / `>=2,<3` / `>=1.11,<2` | **FastF1 3.8.3 exige pandas<3 y numpy<3**; no usar pandas 3.0 |
| | pyarrow / duckdb | 26.0 / 1.5 | Parquet + consultas |
| | apscheduler | 3.11 (no 4.x) | |
| | argon2-cffi / pyjwt / email-validator | 25.1 / 2.15 / 2.3 | |
| | httpx / aiosmtplib / feedparser | 0.28 / 5.1 / 6.0 | |
| | structlog / sentry-sdk | 26.1 / 2.72 | |
| | redis / paho-mqtt | 8.1 / 2.1 | solo Fase 5 |
| | pytest / pytest-asyncio / ruff / mypy | 9.1 / 1.4 / 0.17 / 2.4 | |
| | uv | 0.10 | instalado localmente |
| Frontend | node / npm | 25 / 11 | instalados; Vite 8 pide node ≥22.12 |
| | react / react-dom | 19.3 | |
| | vite / @vitejs/plugin-react | 8.3 / 6.1 | |
| | **typescript** | **~5.9** | typescript-eslint todavía exige `<6.1`; **no** usar TS 7 |
| | tailwindcss / @tailwindcss/vite | 4.3 | build, nunca CDN |
| | @tanstack/react-query | 5.104 | |
| | react-router | 8.4 | paquete `react-router` (no `react-router-dom`), `BrowserRouter` |
| | zustand | 5.0 | estado del player |
| | vite-plugin-pwa | 2.0 | |
| | uplot | 1.6 | charts de telemetría y lap times |
| | openapi-typescript / openapi-fetch | 7.13 / 0.17 | tipos generados desde OpenAPI |
| | vitest / @testing-library/react / jsdom | 5.0 / 16.3 / 30 | |
| | @playwright/test | 1.64 | e2e en CI (chromium + viewport móvil) |
| | eslint / typescript-eslint | 10 / 8.71 | |
| | lucide-react | 1.55 | |

**Spec:** [`propuesta.md`](../../../propuesta.md) (raíz de este repo). Cada plan de fase argumenta desde la propuesta; los ejecutores leen ambos.

---

## 1. Decisiones y supuestos

Las decisiones "pendientes" de §11 de la propuesta se resuelven así (si el dueño del proyecto decide distinto, se cambia el plan antes de ejecutar la fase afectada):

| # | Tema | Decisión adoptada | Dónde impacta |
|---|---|---|---|
| D1 | Repo nuevo | **Sí.** Se crea `E:\Proyectos\f1-predictor-pro` (repo `gedardo/f1-predictor-pro`, privado hasta limpiar). De v2 se copian solo componentes/páginas y las reglas de `constants.ts`. El historial de v2 no se hereda. | Fase 0 T1 |
| D2 | Tamaño del VPS | Se asume **≥ 8 GB RAM** en Easypanel. Si no, el backfill de FastF1 (Fase 3) y los chunks (Fase 4) se generan en la PC local (16 GB RAM, 20 hilos) y se suben a los volúmenes con `rsync`/`scp`. El worker tiene un modo `INGEST_LOCAL_ONLY`. | Fase 3 T8, Fase 4 T4 |
| D3 | OpenF1 real-time | Se decide al llegar a la Fase 5. Hasta entonces la pantalla "En vivo" muestra cuenta regresiva + timing post-sesión. | Fase 5 |
| D4 | SMTP | Proveedor pendiente. El backend tiene backend de mail intercambiable: `console` (dev: escribe `.eml` en `apps/api/.dev-mail/` y loguea el link) y `smtp` (prod, aiosmtplib). Recomendación: Resend o Brevo (plan gratuito, SMTP). | Fase 2 T3 |
| D5 | Docker local | En esta PC **no hay Docker** (ni WSL). Fase 0 T0 instala Docker Desktop vía `winget`. Si no se puede, hay camino alternativo: Postgres 17 nativo vía `winget` + `uv run` + `npm run dev`. Ambos caminos están documentados y probados en Fase 0. | Fase 0 T0 |
| D6 | f1-race-replay como servicio | **No se corre la app upstream como servicio.** Es una app de escritorio (PySide6 + Arcade): `main.py` crea un `QApplication` y una `arcade.Window`; el único "servidor" que tiene (`src/services/stream.py`) es un socket TCP en `localhost:9999` que emite frames JSON **a ritmo de reproducción y solo mientras la ventana está abierta**, previa selección de la carrera en la GUI. No hay API, no hay modo headless ni CLI de exportación. Lo que sí se hace: `src/f1_data.py`, `src/bayesian_tyre_model.py` y `src/lib/*` **no importan la GUI** (solo fastf1/numpy/pandas), así que se portan al `worker` como paquete `f1data` y se corren headless en Easypanel. La lógica de vueltas y gaps vive como métodos estáticos dentro de `F1RaceReplayWindow` (`race_replay.py:367-1175`) y hay que extraerla a funciones puras. Upstream no tiene tags ni releases: se fija el commit `8136931` (2026-10-09). | Fase 3, Fase 4 |
| D7 | Reglas de qualy | Como en v2, de la predicción de Top 3 de qualy solo puntúa la pole (10). P2/P3 se guardan pero no suman. Se deja un `TODO` de producto en `RulesPage`. | Fase 2 T6 |
| D8 | Podio sprint | P1 exacto = 15 (no suma además los 8 del podio). P2/P3 exactos = 8 cada uno. | Fase 2 T6 |
| D9 | Cierre de predicciones | Qualy y carrera cierran al `starts_at` de la sesión Q; sprint y sprint qualy al `starts_at` de SQ. `PREDICTION_LOCK_OFFSET_MINUTES` (default 0) permite cerrar antes. | Fase 2 T5 |
| D10 | Fantasy | 4 pilotos + 2 escuderías, 5 cambios por temporada. Snapshot al cierre de la qualy. Puntos = sistema F1 vigente (sin punto por VR) + puntos de sprint. Escudería = suma de sus dos pilotos. | Fase 2 T7 |
| D11 | Rutas | URLs de la web en español (`/calendario`, `/predicciones/:eventId`, `/mi-equipo`…); API en inglés bajo `/api` como en §8. | todas |
| D12 | Idioma | Toda la UI, mensajes de error, emails, logs de usuario y documentación en **español rioplatense neutro** (vos → se usa "tu/tus" neutro en UI). i18n real recién en Fase 6. | todas |
| D13 | Identidad de pilotos/equipos | Clave interna entera; claves naturales: `drivers.ref` (id de Jolpica, p. ej. `max_verstappen`), `drivers.code` (`VER`), `drivers.number`; `teams.ref` (`red_bull`); `circuits.ref` (`monza`). FastF1 y OpenF1 se mapean por `code`/`number`. | Fase 1a T2 |
| D14 | Colores de equipo | Se guardan como **hex** (`#3671C6`), nunca como clase Tailwind (v2 lo hacía y rompe con Tailwind v4). | Fase 1a |
| D15 | Horarios | Todo en DB en UTC (`timestamptz`). La web formatea con `Intl.DateTimeFormat` en la zona del navegador. | todas |
| D16 | Plan B si FastF1 deja de funcionar (§4.1) | El normalizador OpenF1 → `Frame` de la Fase 5 (`app/live/state.py`) se diseña para aceptar también el histórico de OpenF1 (`location`, `car_data`, `position`, `intervals` a 3,7 Hz, 2023+). Si el archivo de livetiming deja de estar disponible, las Fases 3 y 4 se alimentan de ahí para 2023+ con un handler `openf1_replay_build`; 2018–2022 quedarían solo con lo ya ingerido. | Fase 5 T1, Fase 3 T6 |
| D17 | Prototipo opcional de §10 | Si queda tiempo en 2026, antes de fijar el codec se puede generar un replay de una carrera 2026 con las Tareas 1–2 de la Fase 4 corriendo en la PC local (sin UI) y validar el tamaño y el contrato `Frame`. No bloquea el orden de fases. | Fase 4 T1–T2 |

## 2. Restricciones globales

Copiadas de la propuesta; aplican a todas las tareas de todos los planes.

- Proyecto de fans, **sin fines comerciales** (condiciona OpenF1 CC BY-NC-SA 4.0, dumps gratuitos de Jolpica y datos de FOM).
- MIT de f1-race-replay: conservar aviso de copyright en `THIRD_PARTY_NOTICES.md` con atribución a Tom Shaw (`IAmTomShaw/f1-race-replay`).
- Backend Python 3.12 + FastAPI, SQLAlchemy 2 async + Alembic, Pydantic v2, `uv`.
- Frontend React 19 + Vite + TS strict, Tailwind v4 (build, no CDN), TanStack Query, React Router (BrowserRouter), Zustand para el player, `vite-plugin-pwa`.
- OpenAPI de FastAPI → `openapi-typescript` genera los tipos del front. Nunca escribir tipos de API a mano.
- Mismo origen: la API se sirve bajo `/api`; nginx hace de proxy.
- Auth propia: argon2id, access JWT de 15 min + refresh rotativo (hash en DB), cookies httpOnly/Secure/SameSite=Lax, verificación de email y reset por SMTP, rate limit en Postgres, rol `user`/`admin` en DB, borrado de cuenta.
- Postgres 17 **sin puerto público**; backups de Easypanel con prueba de restauración; migraciones Alembic versionadas.
- Telemetría pesada **no va a Postgres**.
- Jobs: APScheduler + cola `ingest_runs` con reintentos y `pg_advisory_lock` (un job pesado a la vez). Redis recién en Fase 5.
- Leaderboards por query con índices (sin vistas materializadas).
- FastF1 versión fijada + test de contrato.
- Observabilidad: Sentry (o GlitchTip) + logs estructurados.
- Charts: uPlot para series largas, SVG para estrategia de neumáticos, Canvas 2D para el mapa del replay.
- Jolpica: 4 req/s y 500 req/h sin auth, User-Agent obligatorio con nombre y versión de la app. Histórico desde dumps CSV, no por API.
- OpenF1 histórico gratis: 3 req/s y 30 req/min.
- Worker: FastF1 con telemetría usa 2–4 GB por carrera → 1 sesión a la vez y máximo 2 procesos.
- Cloudflare corta WebSockets inactivos a ~100 s → ping cada 30 s.
- Contrato `Frame` de §4.3: replay y en vivo emiten el mismo tipo.
- Correcciones obligatorias de §4.4 al portar race-replay.

## 3. Estándares transversales

Cada tarea de cada fase hereda estas reglas. Los planes de fase solo repiten lo específico.

### 3.1 Seguridad

| Área | Regla concreta | Verificación |
|---|---|---|
| Contraseñas | argon2id (`argon2-cffi` `PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)`), mínimo 10 caracteres, rechazo de las 10k más comunes (lista en `app/auth/common_passwords.txt`), `needs_rehash` al login. | tests `test_passwords.py` |
| Sesión | Access JWT HS256 (`exp` 15 min, `sub`, `role`, `jti`), cookie `access_token` httpOnly, `Secure` en prod, `SameSite=Lax`, `Path=/`. Refresh opaco (32 bytes aleatorios) guardado como SHA-256 en `refresh_tokens` con `family_id`; rotación en cada uso; reuso de un token rotado **revoca toda la familia**. Cookie `refresh_token` con `Path=/api/auth`. | `test_auth_flow.py::test_refresh_reuse_revokes_family` |
| CSRF | SameSite=Lax + header obligatorio `X-Requested-With: fetch` en todo método no seguro + validación de `Origin` contra `ALLOWED_ORIGINS`. Middleware `CsrfMiddleware`. | `test_csrf.py` |
| Rate limit | Tabla `rate_limits(key, window_start, count)` con función SQL `bump_rate_limit(key, limit, window_seconds) → bool`. Claves: `login:ip:{ip}` 20/15 min, `login:email:{email}` 5/15 min, `register:ip` 5/h, `forgot:email` 3/h, `guess:user` 3/día. Respuesta 429 con `Retry-After`. | `test_ratelimit.py` |
| Enumeración | Registro, login, forgot y reset devuelven mensajes idénticos exista o no el email; tiempos homogéneos (se hashea un dummy cuando el usuario no existe). | `test_auth_enumeration.py` |
| Roles | `users.role ∈ {user, admin}`; dependencia `require_admin` en **cada** endpoint `/api/admin/*`. Nunca por email. | `test_admin_guard.py` |
| Validación | Pydantic `model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)`. Nick: `^[a-zA-Z0-9_]{3,20}$`. Email normalizado con `email-validator`. Límites de tamaño de body (1 MB) en nginx. | tests por schema |
| Cabeceras | nginx: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Fuentes auto-hospedadas (no Google Fonts). | `curl -I` en Fase 0 T6 |
| Secretos | Solo por variables de entorno; `.env` en `.gitignore`; `.env.example` sin valores reales; `gitleaks` en CI; `SECRET_KEY` ≥ 32 bytes aleatorios (`openssl rand -hex 32`). | CI |
| DB | Usuario de app sin `SUPERUSER`; queries solo por SQLAlchemy (sin f-strings SQL); `statement_timeout=15s` en la API; DB sin puerto público. | revisión |
| WebSocket | Autenticación por cookie en el upgrade; chequeo de `Origin`; máximo 2 conexiones por usuario; ping/pong 30 s; cierre 4401 si expira el access token. | Fase 5 tests |
| Archivos | Los chunks del replay los sirve nginx desde `root /data/replay` con `location ^~ /replay/` y sin `alias`; la API nunca construye rutas con input del usuario (solo ids numéricos → ruta canónica). | Fase 4 T3 |
| Logs y errores | `structlog` JSON; nunca loguear contraseñas, tokens, cookies ni emails completos (se enmascaran `a***@dominio`). Sentry `send_default_pii=False`. Respuestas de error sin stack traces. | revisión |
| Dependencias | `uv lock` y `package-lock.json` versionados; `pip-audit` y `npm audit --audit-level=high` en CI; Dependabot semanal. | CI |
| Cuenta | `DELETE /api/me` exige contraseña actual; borra en cascada usuario, perfil, tokens, predicciones, equipo, ligas propias (transfiere o elimina), partidas. | `test_delete_account.py` |
| Admin | Acciones de admin quedan en `admin_audit_log(user_id, action, target, at)`. | Fase 2 T10 |

### 3.2 Rendimiento

| Área | Regla concreta | Métrica / verificación |
|---|---|---|
| API | Endpoints de lectura pública con `Cache-Control: public, max-age=60` (calendario, standings, resultados) y `ETag`. Paginación obligatoria (`limit ≤ 200`) en vueltas, mensajes, noticias. Índices declarados en los modelos y verificados con `EXPLAIN` en tests de carga liviana. Pool asyncpg `pool_size=10, max_overflow=5`. | p95 < 150 ms en endpoints de DB con 1000 usuarios seed |
| Leaderboards | Índices `score_entries(season_id, user_id)`, `(event_id)`, `league_members(league_id, user_id)`. Query única con `SUM ... GROUP BY` y `RANK()`. | `EXPLAIN` sin seq scan sobre `score_entries` |
| Front | Code splitting por ruta (`React.lazy`), bundle inicial < 250 kB gz, imágenes con `loading="lazy"` y tamaños fijos (sin CLS), fuentes `font-display: swap` auto-hospedadas, `prefers-reduced-motion` respetado. TanStack Query `staleTime` por recurso (calendario 5 min, standings 5 min, predicción 0). | Lighthouse móvil ≥ 90 en Performance en Home y Calendario |
| Replay | Chunks de 60 s, binarios cuantizados, pre-comprimidos (`gzip_static`), `Cache-Control: public, max-age=31536000, immutable` en `/replay/*` versionado. Decodificación en Web Worker. Canvas con `devicePixelRatio` limitado a 2. Prefetch del chunk siguiente. | 60 fps en móvil de gama media; < 10 MB por carrera |
| Telemetría | Parquet con compresión zstd, particionado por sesión, lectura con DuckDB filtrando por piloto/vuelta (`read_parquet` con `filename` fijo). Respuesta de `/telemetry` remuestreada a ≤ 2000 puntos por canal. | < 300 ms por vuelta |
| Worker | Una sesión de FastF1 a la vez (`pg_advisory_lock(42)`), máximo 2 procesos, limpieza del caché de FastF1 al terminar cada sesión, `MALLOC_ARENA_MAX=2`. | RAM < 4 GB observada |
| nginx | `gzip on` para JSON/JS/CSS, `gzip_static on` para `/replay/*`, `http2`, assets de Vite con hash + `immutable`. | `curl -I` |

### 3.3 Responsive / móvil

- **Mobile-first.** Breakpoints Tailwind: base (≤ 639 px, teléfono), `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Toda pantalla se diseña primero a 375×812 y después se expande.
- **Navegación:** barra inferior (`BottomNav`) con 5 destinos en `< md` (Inicio, Calendario, Predecir, Rankings, Más) y `Navbar` superior en `≥ md`. v2 no tenía menú móvil: es un defecto conocido que se corrige en Fase 0 T7.
- **Objetivos táctiles ≥ 44×44 px**, separación ≥ 8 px. Botones de ancho completo en móvil.
- **Tablas:** en móvil se convierten en tarjetas (`<ul>` con `grid`) o quedan en un contenedor `overflow-x-auto` con la primera columna fija (`sticky left-0`). Nunca `min-w-max` sin contenedor con scroll.
- **Tipografía fluida:** `text-2xl sm:text-3xl lg:text-4xl` para h1; nunca `text-5xl` fijo (defecto de v2 en Auth).
- **Altura:** `min-h-dvh` (no `100vh`) y `padding-bottom: env(safe-area-inset-bottom)` en la barra inferior; `viewport-fit=cover`.
- **Formularios:** `inputmode`, `autocomplete` (`email`, `current-password`, `new-password`, `username`), `enterkeyhint`; nada de `hover:scale-105` en tarjetas (v2 lo usaba).
- **Replay y charts:** gestos táctiles (pinch para zoom en el mapa, arrastre en la barra de tiempo), controles de 48 px, modo apaisado sugerido pero no obligatorio.
- **PWA:** `manifest.webmanifest` con `display: standalone`, iconos 192/512 maskable, `theme_color #0f172a`, pantalla instalable desde Fase 0.
- **Verificación obligatoria por tarea de UI:** screenshot en el navegador interno con preset `mobile` (375×812) y `desktop`; sin scroll horizontal; Lighthouse móvil en CI (Fase 0 T9) con umbrales Performance ≥ 85, Accessibility ≥ 95.

### 3.4 Español

- Textos de UI en `apps/web/src/i18n/es.ts` como objeto tipado `const es = {...} as const` y helper `t('clave')`; **ningún string de UI inline en JSX** (así la Fase 6 agrega `en.ts` sin tocar componentes).
- Mensajes de error de la API en español en el campo `detail` con `code` estable en inglés para la UI: `{"detail": "El email ya está registrado.", "code": "email_taken"}`.
- Fechas: `Intl.DateTimeFormat('es-AR', {...})`; números: `Intl.NumberFormat('es-AR')`.
- Emails transaccionales en español (plantillas en `app/auth/templates/*.txt` y `.html`).
- Commits, PRs y documentación en español; identificadores de código en inglés.

### 3.5 Pruebas

| Nivel | Herramienta | Dónde corre | Regla |
|---|---|---|---|
| Unit backend | pytest | local + CI | Scoring, codecs, normalizadores, auth puro. Sin DB. |
| Integración backend | pytest + Postgres real (`DATABASE_URL_TEST`) con transacción por test | local + CI (servicio postgres en GitHub Actions) | Cada router. `httpx.AsyncClient(transport=ASGITransport)`. |
| Contrato FastF1 | pytest marcado `@pytest.mark.network` | manual + CI semanal | Fija columnas y tipos de `_extended_timing_data`, `laps`, `results`, `get_circuit_info`. |
| Unit/componentes front | vitest + testing-library | local + CI | Lógica de interpolación, decodificador de chunks, formateadores, componentes con estado. |
| e2e | Playwright (chromium desktop 1280×800 y `Pixel 7`) | CI contra `docker compose` | Flujos: registro→verificación→login, predicción, fantasy, adivina, admin. |
| **Navegador interno (manual asistido)** | herramientas `mcp__Claude_Browser__*` | al cerrar cada tarea de UI y al cerrar cada fase | Protocolo en §3.6. |
| Carga liviana | `locust` (opcional) o script `k6` | antes de cada deploy | 200 usuarios virtuales en leaderboard y calendario. |

### 3.6 Protocolo de verificación en el navegador interno

Se ejecuta con las herramientas del navegador integrado del Claude desktop (`preview_start`, `navigate`, `resize_window`, `computer` screenshot, `read_console_messages`, `read_network_requests`). Cada plan de fase lo invoca al final de las tareas de UI con el nombre **"Verificación en navegador interno"** y una lista concreta.

Pasos base (se copian en cada tarea con sus particulares):

1. Levantar el entorno: `preview_start` con `name: "f1-dev"` (definido en `.claude/launch.json` en Fase 0 T8; levanta `docker compose -f infra/docker-compose.dev.yml up` o, sin Docker, `scripts/dev.ps1`). URL: `http://localhost:5173`.
2. `resize_window` preset `mobile` → recorrer la pantalla, screenshot, verificar: sin scroll horizontal, barra inferior visible, textos legibles, botones ≥ 44 px.
3. `resize_window` preset `desktop` → screenshot.
4. `read_console_messages onlyErrors: true` → debe estar vacío (salvo errores esperados y anotados).
5. `read_network_requests` → sin 4xx/5xx inesperados; respuestas de `/api` con cabeceras de caché esperadas.
6. Flujo funcional con los usuarios seed (§3.7).
7. Anotar el resultado en el PR de la tarea (capturas móvil y desktop).

### 3.7 Usuarios de prueba (la app no está en producción)

Los crea `apps/api/app/seed.py` (Fase 2 T2) y los recrea `make seed` / `uv run python -m app.seed --reset`. Las contraseñas de prueba viven **solo** en `seed.py` y en `apps/api/.env.example` (variable `SEED_PASSWORD`), nunca en chats ni en documentación.

| Email | Nick | Rol | Estado | Uso |
|---|---|---|---|---|
| `admin@f1pp.test` | `admin` | admin | verificado | Panel admin, Piloto del Día, recalcular, cola de ingesta |
| `ana@f1pp.test` | `ana_f1` | user | verificado | Usuaria con predicciones y equipo completo |
| `bruno@f1pp.test` | `bruno` | user | verificado | Usuario con liga propia (`LIGA-AMIGOS`) |
| `carla@f1pp.test` | `carla` | user | **sin verificar** | Probar flujo de verificación y bloqueo de login |
| `dario@f1pp.test` | `dario` | user | verificado, sin datos | Probar estados vacíos |

Además el seed genera 200 usuarios sintéticos (`user001@f1pp.test`…) con predicciones aleatorias para probar rankings y rendimiento. Dominio `.test` (RFC 2606) para que nunca se envíe mail real.

## 4. Fases, orden y dependencias

Orden de ejecución (igual que §10 de la propuesta): **0 → 1a → 2 → 1b → 3 → 4 → 5 → 6**. Objetivo: 0, 1a y 2 listas para el arranque de 2027.

| Fase | Plan | Tamaño | Depende de | Criterio de "listo" (de la propuesta) |
|---|---|---|---|---|
| 0. Fundaciones | [`…-01-fase-0-fundaciones.md`](2026-10-12-f1-predictor-v3-01-fase-0-fundaciones.md) | S | — | `docker compose up` levanta todo; CI pasa; deploy en Easypanel de un "hello" api + web |
| 1a. Temporada en curso | [`…-02-fase-1a-temporada-en-curso.md`](2026-10-12-f1-predictor-v3-02-fase-1a-temporada-en-curso.md) | S | 0 | Temporada 2026 completa y correcta; re-sync idempotente |
| 2. Usuarios + juego | [`…-03-fase-2-usuarios-y-juego.md`](2026-10-12-f1-predictor-v3-03-fase-2-usuarios-y-juego.md) | L | 1a | Tests de scoring con casos reales incl. descalificación posterior; no hay forma de escribir puntos desde el cliente |
| 1b. Histórico + estadísticas | [`…-04-fase-1b-historico-estadisticas.md`](2026-10-12-f1-predictor-v3-04-fase-1b-historico-estadisticas.md) | M | 1a | Totales históricos coinciden con fuentes públicas en una muestra |
| 3. Análisis de sesión | [`…-05-fase-3-analisis-de-sesion.md`](2026-10-12-f1-predictor-v3-05-fase-3-analisis-de-sesion.md) | XL | 1a, 2 (admin) | Una carrera y una qualy se ingieren solas; backfill 2018→hoy completo y retomable |
| 4. Race Replay web | [`…-06-fase-4-race-replay.md`](2026-10-12-f1-predictor-v3-06-fase-4-race-replay.md) | L | 3 | 60 fps en móvil de gama media; < 10 MB por carrera |
| 5. En vivo | [`…-07-fase-5-en-vivo.md`](2026-10-12-f1-predictor-v3-07-fase-5-en-vivo.md) | M | 4, suscripción OpenF1 | Sesión real (FP) sin cortes; reconexión automática |
| 6. Extras | [`…-08-fase-6-extras.md`](2026-10-12-f1-predictor-v3-08-fase-6-extras.md) | M | 3, 2 | — |

Cada fase se ejecuta en su propia rama `fase-N/<nombre>` del repo nuevo, con PRs chicos por tarea hacia la rama de la fase y un PR final de la fase hacia `main`.

## 5. Estructura del repo nuevo

```
f1-predictor-pro/
├── CLAUDE.md                        convenciones, comandos, reglas (se escribe en Fase 0 T1)
├── README.md · THIRD_PARTY_NOTICES.md · LICENSE (MIT)
├── .github/workflows/ci.yml         ruff + mypy + pytest | eslint + tsc + vitest + build + playwright + gitleaks
├── .claude/launch.json              preview "f1-dev" para el navegador interno
├── docs/superpowers/plans/          estos planes (copiados desde v2)
├── apps/
│   ├── web/                         React + Vite + TS + Tailwind v4 + PWA
│   │   ├── src/{api,auth,components,features,i18n,lib,pwa,styles}
│   │   ├── Dockerfile · nginx/{nginx.conf.template,security-headers.conf,real-ip.conf}
│   │   ├── e2e/                     Playwright
│   │   └── tests/                   vitest
│   └── api/
│       ├── pyproject.toml · uv.lock · alembic.ini · Dockerfile · docker-entrypoint.sh
│       ├── alembic/versions/
│       ├── app/
│       │   ├── main.py · config.py · db.py · seed.py
│       │   ├── models/   reference.py results.py timing.py users.py game.py ingest.py news.py
│       │   ├── schemas/
│       │   ├── auth/     passwords.py tokens.py deps.py router.py mail.py ratelimit.py csrf.py
│       │   ├── routers/  health.py seasons.py events.py sessions.py standings.py stats.py
│       │   │             me.py predictions.py fantasy.py leaderboards.py leagues.py guess_game.py admin.py
│       │   ├── services/ jolpica.py openf1.py predictions.py fantasy.py leagues.py guess.py news.py
│       │   ├── scoring/  base.py v2026.py engine.py
│       │   ├── worker/   __main__.py scheduler.py queue.py jobs/{jolpica_sync,scoring,fastf1_ingest,openf1_ingest,replay_build,rss,backfill}.py
│       │   └── live/     __main__.py ingestor.py normalizer.py ws.py
│       ├── f1data/                  port de f1-race-replay sin GUI
│       │   ├── session_loader.py frames.py laps.py gaps.py pits.py circuit.py safety_car.py
│       │   ├── replay_codec.py parquet_writer.py tyre_model.py
│       │   └── lib/{sectors,tyres,time}.py (copiados tal cual con sus tests)
│       └── tests/
├── infra/
│   ├── docker-compose.dev.yml       postgres + api + worker + web (+ redis en Fase 5)
│   └── easypanel.md                 servicios, variables, volúmenes, backups, restauración
└── scripts/
    ├── dev.ps1                      camino sin Docker (Postgres nativo + uv + npm)
    ├── gen-api-types.ps1            openapi-typescript
    └── restore-test.ps1             prueba de restauración de backup
```

## 6. Foco de revisión (riesgos que ningún test de fase cubre por sí solo)

1. **Cambio de resultado después de puntuar** (penalización/descalificación días después): el `source_hash` debe cambiar, el evento volver a `provisional` y los `score_entries` reemplazarse en una sola transacción. Test en Fase 2 T8.
2. **Usuario que guarda la predicción justo al cierre**: el servidor compara `now()` con `starts_at` de la sesión en la misma transacción que el `UPSERT`; no vale el reloj del cliente. Test en Fase 2 T5.
3. **Cambio de horario de una sesión por Jolpica** (p. ej. qualy movida por clima): el re-sync actualiza `starts_at` y los cierres se recalculan; las predicciones ya cerradas no se reabren si la nueva hora es futura pero ya hubo snapshot. Test en Fase 1a T5.
4. **Sesión sin datos en FastF1** (cancelada, o archivo no disponible): `ingest_runs` termina en `failed` con error legible, con reintentos limitados (3) y sin bloquear la cola. Test en Fase 3 T6.
5. **Chunk corrupto o manifest desactualizado en el player**: el cliente valida magic/version/longitudes y muestra "Replay no disponible" sin romper la app; el worker escribe manifest **después** de todos los chunks y versiona la carpeta. Test en Fase 4 T2 y T5.

## 7. Método de ejecución

Recomendado: **subagent-driven** por tarea para Fases 0, 1a y 2 (muchas interfaces compartidas: modelos, schemas, tipos generados) con revisor fresco por tarea; para Fases 3–6, ejecución nativa por tarea con revisión al final de cada tarea grande (port de código de terceros donde conviene contexto largo).

Antes de empezar cada fase: `superpowers:using-git-worktrees` para abrir la rama `fase-N/...` en un worktree aislado del repo nuevo.
