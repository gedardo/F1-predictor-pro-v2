# Fase 0 — Fundaciones: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Dejar un monorepo nuevo con API (FastAPI) y web (React) mínimas que levantan con `docker compose up` (o sin Docker con `scripts/dev.ps1`), CI verde, nginx sirviendo web + `/api` en el mismo origen, Sentry, PWA instalable y un deploy "hello" funcionando en Easypanel.

**Arquitectura:** Ver plan maestro §5. En esta fase no hay tablas de dominio: solo la baseline de Alembic, `/api/health`, el shell de la web (Navbar + BottomNav responsive, ruteo, i18n, TanStack Query, tipos generados desde OpenAPI) y la infraestructura.

**Tech Stack:** versiones del plan maestro (tabla de stack). Python 3.12 + uv; Node 25 + npm 11.

**Spec:** `propuesta.md` §3 (arquitectura), §9 (estructura), §10 fila "0. Fundaciones". **Plan maestro:** `2026-10-12-f1-predictor-v3-00-plan-maestro.md` (restricciones §2 y estándares §3 aplican a todas las tareas).

## Restricciones globales

- Repo nuevo `E:\Proyectos\f1-predictor-pro`, remoto `gedardo/f1-predictor-pro` (privado).
- Mismo origen: web en `/`, API en `/api`, replay en `/replay/*`.
- Tailwind v4 por build; nada de CDN ni importmaps (v2 cargaba React desde esm.sh).
- TypeScript `~5.9`, `strict: true`. Tipos de API solo generados.
- Python 3.12, `uv`, `ruff`, `mypy --strict` en `app/` (en `f1data/` se relaja a `--check-untyped-defs` desde Fase 3).
- Todo texto de UI en `src/i18n/es.ts`.

## Foco de revisión

1. **Cookies en dev sin HTTPS:** `Secure` se activa solo si `settings.env == "prod"`; si queda fijo, el login nunca funciona en `http://localhost`. Test en T2 (`test_config.py::test_cookie_secure_flag_by_env`).
2. **Proxy de WebSocket en nginx:** sin `Upgrade`/`Connection` el WS de la Fase 5 falla en prod pero no en dev. Se deja configurado y probado con `curl --http1.1 -H "Upgrade: websocket"` en T5.
3. **SPA fallback vs `/api`:** si `try_files` captura `/api/*` inexistentes devuelve `index.html` con 200 y la UI muestra HTML como JSON. T5 prueba `curl /api/nope` → 404 JSON.
4. **Barra inferior tapando contenido:** `main` necesita `pb-[calc(4rem+env(safe-area-inset-bottom))]` en `< md`. Verificación móvil en T3.
5. **Sentry filtrando PII:** `send_default_pii=False` y `before_send` que borra `request.cookies` y `headers.authorization`. Test en T7.

---

### Tarea 0: Entorno local (Docker Desktop o Postgres nativo)

**Archivos:**
- Crear: `E:\Proyectos\f1-predictor-pro\scripts\check-env.ps1`
- Crear: `E:\Proyectos\f1-predictor-pro\scripts\install-docker.ps1`
- Crear: `E:\Proyectos\f1-predictor-pro\scripts\install-postgres.ps1`

**Interfaces:**
- Produce: Postgres 17 escuchando en `localhost:5432` con usuario `f1` / base `f1` y `f1_test` (por Docker o nativo).

- [ ] **Paso 1: Crear la carpeta del repo y el script de chequeo**

```powershell
New-Item -ItemType Directory -Force E:\Proyectos\f1-predictor-pro\scripts | Out-Null
```

`scripts/check-env.ps1`:

```powershell
# Verifica el toolchain local. Salida 0 si todo está.
$ok = $true
function Check($name, $cmd, $min) {
  try { $v = & $cmd 2>$null | Select-Object -First 1; Write-Host ("OK   {0,-14} {1}" -f $name, $v) }
  catch { Write-Host ("FALTA {0,-13} (min {1})" -f $name, $min); $script:ok = $false }
}
Check "node"   { node -v } "22.12"
Check "npm"    { npm -v } "10"
Check "python" { python --version } "3.12"
Check "uv"     { uv --version } "0.5"
Check "git"    { git --version } "2.40"
Check "gh"     { gh --version } "2.0"
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) { Write-Host "OK   docker         $(docker --version)" } else { Write-Host "INFO docker no instalado: usar scripts/install-docker.ps1 o scripts/install-postgres.ps1" }
$pg = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
if ($pg.TcpTestSucceeded) { Write-Host "OK   postgres:5432" } else { Write-Host "INFO postgres:5432 no responde" }
if (-not $ok) { exit 1 }
```

- [ ] **Paso 2: Ejecutarlo y confirmar el estado actual**

Run: `powershell -File E:\Proyectos\f1-predictor-pro\scripts\check-env.ps1`
Expected: `OK` para node, npm, python, uv, git, gh; `INFO docker no instalado`; `INFO postgres:5432 no responde`.

- [ ] **Paso 3: Script de instalación de Docker Desktop (camino recomendado)**

`scripts/install-docker.ps1`:

```powershell
# Requiere consola de administrador. Instala WSL2 + Docker Desktop. Pide reinicio.
wsl --install --no-distribution
winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
Write-Host "Reiniciar Windows, abrir Docker Desktop una vez y volver a correr scripts/check-env.ps1"
```

- [ ] **Paso 4: Script alternativo de Postgres nativo (si Docker no es viable)**

`scripts/install-postgres.ps1`:

```powershell
# Instala PostgreSQL 17 nativo y crea usuario/bases de desarrollo.
winget install -e --id PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$env:PGPASSWORD = Read-Host "Contraseña del superusuario postgres elegida en el instalador"
& $psql -U postgres -h localhost -c "CREATE ROLE f1 LOGIN PASSWORD 'f1dev' NOSUPERUSER NOCREATEDB;"
& $psql -U postgres -h localhost -c "CREATE DATABASE f1 OWNER f1;"
& $psql -U postgres -h localhost -c "CREATE DATABASE f1_test OWNER f1;"
Write-Host "Listo: postgresql://f1:f1dev@localhost:5432/f1"
```

- [ ] **Paso 5: Ejecutar uno de los dos caminos y verificar**

Run: `powershell -File E:\Proyectos\f1-predictor-pro\scripts\check-env.ps1`
Expected: `OK   postgres:5432` (con Docker se obtiene recién en T5 al levantar compose; con nativo, ahora).

- [ ] **Paso 6: Commit (se hace en T1 cuando exista el repo)**

---

### Tarea 1: Repo nuevo, monorepo, CLAUDE.md y avisos de terceros

**Archivos:**
- Crear: `README.md`, `CLAUDE.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `.gitignore`, `.editorconfig`, `.gitattributes`
- Crear: `apps/web/.gitkeep`, `apps/api/.gitkeep`, `infra/.gitkeep`, `docs/superpowers/plans/` (copiar los 9 planes desde v2)

**Interfaces:**
- Produce: repo git en `E:\Proyectos\f1-predictor-pro`, rama `main`, remoto GitHub privado.

- [ ] **Paso 1: Inicializar repo y remoto**

```bash
cd /e/Proyectos/f1-predictor-pro && git init -b main
gh repo create gedardo/f1-predictor-pro --private --source=. --remote=origin
```

- [ ] **Paso 2: `.gitignore`, `.editorconfig`, `.gitattributes`**

`.gitignore`:

```
# entorno
.env
.env.*
!.env.example
# python
.venv/
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/
apps/api/.dev-mail/
apps/api/.fastf1-cache/
apps/api/data/
# node
node_modules/
dist/
apps/web/dev-dist/
apps/web/playwright-report/
apps/web/test-results/
# editores
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
# datos locales
infra/.data/
```

`.editorconfig`:

```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
[*.py]
indent_size = 4
```

`.gitattributes`:

```
* text=auto eol=lf
*.ps1 text eol=crlf
*.bin binary
*.parquet binary
```

- [ ] **Paso 3: `CLAUDE.md` del repo nuevo**

```markdown
# F1 Predictor Pro v3

Monorepo: `apps/web` (React 19 + Vite + TS + Tailwind v4, PWA) y `apps/api` (FastAPI + SQLAlchemy 2 async + Alembic; misma imagen para api, worker y live-ingestor). Postgres 17. Specs en `docs/superpowers/plans/`.

## Comandos
- Todo: `docker compose -f infra/docker-compose.dev.yml up` (web http://localhost:5173, api http://localhost:8000/api/docs). Sin Docker: `powershell -File scripts/dev.ps1`.
- API: `cd apps/api && uv sync && uv run uvicorn app.main:app --reload`. Tests: `uv run pytest`. Lint: `uv run ruff check . && uv run ruff format --check . && uv run mypy app`.
- Migraciones: `uv run alembic revision --autogenerate -m "..."`, `uv run alembic upgrade head`.
- Web: `cd apps/web && npm ci && npm run dev`. Tests: `npm test`. Lint: `npm run lint && npm run typecheck`. E2E: `npm run e2e`.
- Tipos de API: `npm run gen:api` (requiere la API corriendo en :8000).
- Seed: `cd apps/api && uv run python -m app.seed` (`--reset` recrea).

## Reglas
- Idioma: UI, errores, emails, commits y docs en español. Identificadores en inglés. Strings de UI solo en `apps/web/src/i18n/es.ts`.
- Nunca escribir tipos de API a mano: `apps/web/src/api/schema.d.ts` se genera.
- Nunca lógica de puntos en el cliente. Todo cierre/validación en el servidor.
- Seguridad: ver plan maestro §3.1. Cookies httpOnly; header `X-Requested-With: fetch` en toda mutación; `require_admin` en `/api/admin/*`.
- Mobile-first (plan maestro §3.3). Toda tarea de UI termina con verificación en el navegador interno (móvil y desktop).
- FastF1 fijado en 3.8.3; pandas < 3. No actualizar sin correr `pytest -m network`.
- Telemetría pesada nunca va a Postgres.
- Commits: `tipo(ámbito): descripción` en español (`feat(api): ...`).
```

- [ ] **Paso 4: `THIRD_PARTY_NOTICES.md` y `LICENSE`**

`THIRD_PARTY_NOTICES.md`:

```markdown
# Avisos de terceros

## f1-race-replay
Partes de `apps/api/f1data/` derivan de **f1-race-replay** (https://github.com/IAmTomShaw/f1-race-replay), commit `8136931` (2026-10-09), © Tom Shaw, licencia MIT (declarada en el README del proyecto upstream).

MIT License

Copyright (c) Tom Shaw

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Datos
- Jolpica-F1 (https://github.com/jolpica/jolpica-f1): API Ergast-compatible; dumps CSV de uso no comercial.
- FastF1 (https://github.com/theoehrly/fast-f1): MIT.
- OpenF1 (https://openf1.org): CC BY-NC-SA 4.0, uso no comercial.
```

`LICENSE`: texto MIT con `Copyright (c) 2026 Gerardo Navarro`.

- [ ] **Paso 5: README y planes**

`README.md` con: qué es, stack, cómo levantar (Docker y sin Docker), enlaces a `docs/superpowers/plans/`. Copiar los planes:

```bash
mkdir -p /e/Proyectos/f1-predictor-pro/docs/superpowers/plans && cp /e/Proyectos/F1-predictor-pro-v2/docs/superpowers/plans/2026-10-12-f1-predictor-v3-*.md /e/Proyectos/f1-predictor-pro/docs/superpowers/plans/ && cp /e/Proyectos/F1-predictor-pro-v2/propuesta.md /e/Proyectos/f1-predictor-pro/docs/propuesta.md
```

Ajustar el enlace `**Spec:**` del plan maestro a `docs/propuesta.md`.

- [ ] **Paso 6: Commit**

```bash
cd /e/Proyectos/f1-predictor-pro && git add -A && git commit -m "chore: inicializar monorepo f1-predictor-pro v3 con planes y avisos de terceros" && git push -u origin main
```

---

### Tarea 2: API mínima (FastAPI, config, DB, Alembic baseline, health, tests)

**Archivos:**
- Crear: `apps/api/pyproject.toml`, `apps/api/.env.example`, `apps/api/alembic.ini`, `apps/api/alembic/env.py`, `apps/api/alembic/script.py.mako`, `apps/api/alembic/versions/0001_baseline.py`
- Crear: `apps/api/app/__init__.py`, `app/config.py`, `app/db.py`, `app/main.py`, `app/logging.py`, `app/models/__init__.py`, `app/models/base.py`, `app/routers/__init__.py`, `app/routers/health.py`, `app/errors.py`
- Crear: `apps/api/tests/conftest.py`, `tests/test_health.py`, `tests/test_config.py`

**Interfaces:**
- Produce: `app.config.settings: Settings` (campos abajo), `app.db.get_db() -> AsyncIterator[AsyncSession]`, `app.models.base.Base`, `app.main.create_app() -> FastAPI`, `GET /api/health -> {"status":"ok","db":"ok","version":str}`.
- Produce fixtures de test: `app`, `client: httpx.AsyncClient`, `db: AsyncSession` (transacción por test).

- [ ] **Paso 1: `pyproject.toml` y dependencias**

```toml
[project]
name = "f1-predictor-api"
version = "3.0.0"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.143,<0.144",
  "uvicorn[standard]>=0.54,<0.55",
  "sqlalchemy[asyncio]>=2.1,<2.2",
  "asyncpg>=0.32,<0.33",
  "alembic>=1.20,<1.21",
  "pydantic>=2.14,<3",
  "pydantic-settings>=2.15,<3",
  "structlog>=26.1,<27",
  "sentry-sdk[fastapi]>=2.72,<3",
  "httpx>=0.28,<0.29",
  "orjson>=3.10",
]

[dependency-groups]
dev = [
  "pytest>=9.1,<10",
  "pytest-asyncio>=1.4,<2",
  "ruff>=0.17,<0.18",
  "mypy>=2.4,<3",
  "asgi-lifespan>=2.1",
]

[tool.ruff]
line-length = 100
target-version = "py312"
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "ASYNC"]
ignore = ["S101"]
[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S105", "S106"]

[tool.mypy]
python_version = "3.12"
strict = true
plugins = ["pydantic.mypy"]
files = ["app"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
markers = ["network: tests que llaman a APIs externas"]
```

Run: `cd apps/api && uv sync` → crea `uv.lock` y `.venv`.

- [ ] **Paso 2: `.env.example` y `config.py`**

`apps/api/.env.example`:

```
ENV=dev
SECRET_KEY=cambiar-por-openssl-rand-hex-32
DATABASE_URL=postgresql+asyncpg://f1:f1dev@localhost:5432/f1
DATABASE_URL_TEST=postgresql+asyncpg://f1:f1dev@localhost:5432/f1_test
ALLOWED_ORIGINS=http://localhost:5173
SENTRY_DSN=
LOG_LEVEL=INFO
```

`app/config.py`:

```python
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    secret_key: str = Field(min_length=32)
    database_url: str
    database_url_test: str | None = None
    allowed_origins: list[str] = ["http://localhost:5173"]
    sentry_dsn: str | None = None
    log_level: str = "INFO"
    app_version: str = "3.0.0"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split(cls, v: str | list[str]) -> list[str]:
        return [s.strip() for s in v.split(",")] if isinstance(v, str) else v

    @property
    def cookie_secure(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
```

- [ ] **Paso 3: Test de config (falla primero)**

`tests/test_config.py`:

```python
from app.config import Settings


def test_cookie_secure_flag_by_env() -> None:
    base = dict(secret_key="x" * 32, database_url="postgresql+asyncpg://u:p@h/db")
    assert Settings(env="dev", **base).cookie_secure is False
    assert Settings(env="prod", **base).cookie_secure is True


def test_allowed_origins_from_csv() -> None:
    s = Settings(secret_key="x" * 32, database_url="postgresql+asyncpg://u:p@h/db",
                 allowed_origins="http://a, http://b")
    assert s.allowed_origins == ["http://a", "http://b"]
```

Run: `uv run pytest tests/test_config.py -v` → Expected: PASS (config ya escrita; si falla, corregir `Settings`).

- [ ] **Paso 4: `db.py`, `models/base.py`, `logging.py`, `errors.py`**

`app/db.py`:

```python
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={"server_settings": {"statement_timeout": "15000", "application_name": "f1-api"}},
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
```

`app/models/base.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

`app/models/__init__.py`: `from app.models.base import Base  # noqa: F401` (las fases agregan imports acá para que Alembic los vea).

`app/logging.py`:

```python
import logging

import structlog

from app.config import settings


def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[settings.log_level]
        ),
    )
```

`app/errors.py`:

```python
from fastapi import HTTPException


class ApiError(HTTPException):
    """Error con mensaje en español y código estable para la UI."""

    def __init__(self, status_code: int, detail: str, code: str) -> None:
        super().__init__(status_code=status_code, detail={"detail": detail, "code": code})
```

- [ ] **Paso 5: Test de health (falla primero)**

`tests/conftest.py`:

```python
import os
from collections.abc import AsyncIterator

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("ENV", "test")
os.environ.setdefault("SECRET_KEY", "t" * 32)
os.environ.setdefault("DATABASE_URL", os.environ.get("DATABASE_URL_TEST",
                      "postgresql+asyncpg://f1:f1dev@localhost:5432/f1_test"))

from app.db import get_db  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
async def engine():
    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    eng = create_async_engine(os.environ["DATABASE_URL"])
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = async_sessionmaker(bind=conn, expire_on_commit=False,
                                     join_transaction_mode="create_savepoint")()
        yield session
        await session.close()
        await trans.rollback()


@pytest.fixture
async def client(db: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def _override() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _override
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
```

`tests/test_health.py`:

```python
from httpx import AsyncClient


async def test_health_reports_db_ok(client: AsyncClient) -> None:
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok", "version": "3.0.0"}


async def test_unknown_api_route_is_json_404(client: AsyncClient) -> None:
    r = await client.get("/api/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
```

Run: `uv run pytest tests/test_health.py -v` → Expected: FAIL (`ModuleNotFoundError: app.main`).

- [ ] **Paso 6: `main.py` y `routers/health.py`**

`app/routers/health.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok", "version": settings.app_version}
```

`app/main.py`:

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import ORJSONResponse

from app.config import settings
from app.logging import configure_logging
from app.routers import health

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info("api.start", env=settings.env, version=settings.app_version)
    yield
    log.info("api.stop")


def create_app() -> FastAPI:
    app = FastAPI(
        title="F1 Predictor Pro API",
        version=settings.app_version,
        lifespan=lifespan,
        default_response_class=ORJSONResponse,
        docs_url="/api/docs" if settings.env != "prod" else None,
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.include_router(health.router, prefix="/api")

    @app.exception_handler(404)
    async def _not_found(request: Request, exc: Exception) -> ORJSONResponse:
        return ORJSONResponse({"detail": "Recurso no encontrado.", "code": "not_found"}, status_code=404)

    return app


app = create_app()
```

- [ ] **Paso 7: Alembic async baseline**

```bash
cd apps/api && uv run alembic init -t async alembic
```

Editar `alembic.ini`: `sqlalchemy.url =` vacío (se toma de env). En `alembic/env.py` reemplazar la obtención de URL y metadata:

```python
from app.config import settings
from app.models import Base
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
```

y en `run_migrations_online` usar `async_engine_from_config(... poolclass=pool.NullPool)` (plantilla async ya lo trae). Crear `alembic/versions/0001_baseline.py`:

```python
"""baseline vacía

Revision ID: 0001
Revises:
Create Date: 2026-10-12
"""
revision = "0001"
down_revision = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
```

- [ ] **Paso 8: Correr tests y lint**

Run: `cd apps/api && uv run alembic upgrade head && uv run pytest -v && uv run ruff check . && uv run ruff format --check . && uv run mypy`
Expected: 4 tests PASS; ruff y mypy sin errores.

- [ ] **Paso 9: Commit**

```bash
git add apps/api && git commit -m "feat(api): esqueleto FastAPI con config, DB async, Alembic baseline y /api/health"
```

---

### Tarea 3: Web mínima (Vite, Tailwind v4, Router, i18n, Query, shell responsive, PWA)

**Archivos:**
- Crear: `apps/web/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `eslint.config.js`, `.env.example`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`, `public/fonts/TitilliumWeb-Regular.woff2`, `public/fonts/TitilliumWeb-SemiBold.woff2`, `public/fonts/TitilliumWeb-Bold.woff2`
- Crear: `src/main.tsx`, `src/App.tsx`, `src/routes.tsx`, `src/styles/app.css`, `src/i18n/es.ts`, `src/i18n/t.ts`, `src/lib/queryClient.ts`, `src/components/layout/AppShell.tsx`, `src/components/layout/Navbar.tsx`, `src/components/layout/BottomNav.tsx`, `src/components/ui/Spinner.tsx`, `src/features/home/HomePage.tsx`, `src/features/misc/NotFoundPage.tsx`
- Crear: `tests/setup.ts`, `tests/BottomNav.test.tsx`

**Interfaces:**
- Produce: `t(key: keyof typeof es): string`, `queryClient`, `AppShell` (layout con `<Outlet/>`), rutas: `/` Home, `*` NotFound. Nav items exportados como `NAV_ITEMS: {to, labelKey, icon}[]` en `src/components/layout/navItems.ts`.

- [ ] **Paso 1: Scaffold**

```bash
cd /e/Proyectos/f1-predictor-pro/apps && npm create vite@latest web -- --template react-ts && cd web && npm i react@^19.3 react-dom@^19.3 react-router@^8.4 @tanstack/react-query@^5.104 zustand@^5 lucide-react@^1.55 && npm i -D typescript@~5.9 vite@^8.3 @vitejs/plugin-react@^6.1 tailwindcss@^4.3 @tailwindcss/vite@^4.3 vite-plugin-pwa@^2 vitest@^5 @testing-library/react@^16.3 @testing-library/jest-dom @testing-library/user-event jsdom@^30 eslint@^10 typescript-eslint@^8.71 eslint-plugin-react-hooks eslint-plugin-react-refresh @playwright/test@^1.64 openapi-typescript@^7.13 openapi-fetch@^0.17 @types/node@^22
```

- [ ] **Paso 2: `package.json` scripts**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "gen:api": "openapi-typescript http://localhost:8000/api/openapi.json -o src/api/schema.d.ts"
  }
}
```

- [ ] **Paso 3: `vite.config.ts` (proxy `/api`, Tailwind, PWA)**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'icons/*.png'],
      manifest: {
        name: 'F1 Predictor Pro',
        short_name: 'F1 Predictor',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/replay\//],
        runtimeCaching: [
          { urlPattern: /^\/api\/(seasons|standings|events|sessions)\//, handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-public', expiration: { maxAgeSeconds: 300 } } },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: false, ws: true } } },
  build: { sourcemap: true, chunkSizeWarningLimit: 300 },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'] },
});
```

`tsconfig.json`: el que genera Vite con `"strict": true`, `"noUnusedLocals": true`, `"noUncheckedIndexedAccess": true`, `"paths": {"@/*": ["./src/*"]}`, `"types": ["vitest/globals", "@testing-library/jest-dom"]`.

- [ ] **Paso 4: `index.html`, `styles/app.css` con tokens de Tailwind v4 y fuentes locales**

`index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>F1 Predictor Pro</title>
  </head>
  <body class="bg-surface text-fg">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/styles/app.css`:

```css
@import "tailwindcss";

@font-face { font-family: "Titillium Web"; font-weight: 400; font-display: swap; src: url("/fonts/TitilliumWeb-Regular.woff2") format("woff2"); }
@font-face { font-family: "Titillium Web"; font-weight: 600; font-display: swap; src: url("/fonts/TitilliumWeb-SemiBold.woff2") format("woff2"); }
@font-face { font-family: "Titillium Web"; font-weight: 700; font-display: swap; src: url("/fonts/TitilliumWeb-Bold.woff2") format("woff2"); }

@theme {
  --font-sans: "Titillium Web", ui-sans-serif, system-ui, sans-serif;
  --color-surface: #0f172a;
  --color-surface-2: #1e293b;
  --color-surface-3: #334155;
  --color-fg: #f1f5f9;
  --color-fg-muted: #94a3b8;
  --color-brand: #e10600;
  --color-brand-hover: #b80500;
  --color-ok: #22c55e;
  --color-warn: #eab308;
  --color-danger: #ef4444;
}

html, body, #root { min-height: 100dvh; }
body { font-family: var(--font-sans); -webkit-tap-highlight-color: transparent; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
```

Descargar las tres fuentes `.woff2` de Titillium Web (Google Fonts, licencia OFL) a `public/fonts/` y generar los íconos PNG (192, 512, maskable 512) con un logo simple "F1" sobre `#0f172a` (p. ej. con `sharp` o cualquier editor). No usar CDN.

- [ ] **Paso 5: i18n y `t()`**

`src/i18n/es.ts`:

```ts
export const es = {
  app_name: 'F1 Predictor Pro',
  nav_home: 'Inicio',
  nav_calendar: 'Calendario',
  nav_predict: 'Predecir',
  nav_rankings: 'Rankings',
  nav_more: 'Más',
  nav_standings: 'Campeonato',
  nav_stats: 'Estadísticas',
  nav_my_team: 'Mi equipo',
  nav_guess: 'Adiviná el piloto',
  nav_rules: 'Reglas',
  nav_profile: 'Perfil',
  nav_admin: 'Admin',
  nav_login: 'Ingresar',
  nav_logout: 'Cerrar sesión',
  home_title: 'Bienvenido a F1 Predictor Pro',
  home_subtitle: 'Datos, análisis, replay y juego de predicciones de Fórmula 1.',
  loading: 'Cargando…',
  not_found_title: 'Página no encontrada',
  not_found_cta: 'Volver al inicio',
  error_generic: 'Algo salió mal. Intentá de nuevo.',
  error_network: 'No hay conexión con el servidor.',
} as const;

export type MessageKey = keyof typeof es;
```

`src/i18n/t.ts`:

```ts
import { es, type MessageKey } from './es';

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = es[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
```

- [ ] **Paso 6: Test del BottomNav (falla primero)**

`tests/setup.ts`: `import '@testing-library/jest-dom/vitest';`

`tests/BottomNav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BottomNav } from '@/components/layout/BottomNav';

test('muestra los cinco destinos con objetivos táctiles de 44px', () => {
  render(<MemoryRouter><BottomNav /></MemoryRouter>);
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(5);
  expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
  for (const l of links) expect(l.className).toContain('min-h-11');
});
```

Run: `npm test` → Expected: FAIL (módulo inexistente).

- [ ] **Paso 7: Layout responsive**

`src/components/layout/navItems.ts`:

```ts
import { Home, CalendarDays, ClipboardList, Trophy, Menu, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '@/i18n/es';

export type NavItem = { to: string; labelKey: MessageKey; icon: LucideIcon };
export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav_home', icon: Home },
  { to: '/calendario', labelKey: 'nav_calendar', icon: CalendarDays },
  { to: '/predicciones', labelKey: 'nav_predict', icon: ClipboardList },
  { to: '/rankings', labelKey: 'nav_rankings', icon: Trophy },
  { to: '/mas', labelKey: 'nav_more', icon: Menu },
];
```

`src/components/layout/BottomNav.tsx`:

```tsx
import { NavLink } from 'react-router';
import { NAV_ITEMS } from './navItems';
import { t } from '@/i18n/t';

export function BottomNav() {
  return (
    <nav aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-3 bg-surface-2/95 backdrop-blur md:hidden pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-xs ${isActive ? 'text-brand' : 'text-fg-muted'}`}>
              <Icon size={22} aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`src/components/layout/Navbar.tsx` (solo `≥ md`): `header` sticky con logo, `NavLink` por cada ítem de `NAV_ITEMS` salvo `nav_more`, más `nav_standings`, `nav_stats`, y a la derecha el slot de usuario (`children`), con clases `hidden md:flex`.

`src/components/layout/AppShell.tsx`:

```tsx
import { Outlet } from 'react-router';
import { Navbar } from './Navbar';
import { BottomNav } from './BottomNav';

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 md:pb-8 lg:px-8">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
```

`src/routes.tsx`:

```tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Spinner';

const HomePage = lazy(() => import('@/features/home/HomePage'));
const NotFoundPage = lazy(() => import('@/features/misc/NotFoundPage'));

export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
```

`src/main.tsx`: `StrictMode` → `QueryClientProvider client={queryClient}` → `BrowserRouter` → `AppRoutes`. `src/lib/queryClient.ts`: `new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } })`. `HomePage` muestra `t('home_title')` como `h1` con `text-2xl sm:text-3xl lg:text-4xl font-bold` y el subtítulo. `NotFoundPage` con link a `/`. `Spinner`: `role="status"` + `aria-label={t('loading')}`.

- [ ] **Paso 8: Correr tests, lint, typecheck y build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: test PASS; sin errores; `dist/` con `sw.js` y `manifest.webmanifest`; chunk inicial < 250 kB gz (ver salida de Vite).

- [ ] **Paso 9: Verificación en navegador interno**

1. `npm run dev` (vía `preview_start` con `name: "web-only"` de `.claude/launch.json`, creado en T8; mientras tanto `preview_start` con `url: http://localhost:5173` tras arrancar en terminal).
2. `resize_window` preset `mobile`: screenshot. Verificar barra inferior con 5 ítems, sin scroll horizontal, `h1` legible.
3. `resize_window` preset `desktop`: Navbar superior visible, BottomNav oculto.
4. `read_console_messages onlyErrors: true` → vacío.
5. Navegar a `/loquesea` → página 404 en español.

- [ ] **Paso 10: Commit**

```bash
git add apps/web && git commit -m "feat(web): shell React 19 + Vite + Tailwind v4 con navegación responsive, i18n y PWA"
```

---

### Tarea 4: Tipos de API generados y cliente `openapi-fetch`

**Archivos:**
- Crear: `apps/web/src/api/client.ts`, `apps/web/src/api/schema.d.ts` (generado), `apps/web/src/api/health.ts`, `scripts/gen-api-types.ps1`
- Modificar: `apps/web/src/features/home/HomePage.tsx`
- Test: `apps/web/tests/client.test.ts`

**Interfaces:**
- Produce: `api` (cliente tipado `createClient<paths>`), `useHealth()` hook, `ApiError` con `{status, detail, code}`.

- [ ] **Paso 1: Generar el schema con la API corriendo**

```bash
cd apps/api && uv run uvicorn app.main:app --port 8000 &
cd ../web && npm run gen:api
```

Expected: `src/api/schema.d.ts` contiene `"/api/health"`.

- [ ] **Paso 2: Test del cliente (falla primero)**

`tests/client.test.ts`:

```ts
import { api, ApiError, toApiError } from '@/api/client';

test('el cliente usa /api y manda el header anti-CSRF en mutaciones', async () => {
  const calls: Request[] = [];
  globalThis.fetch = (async (req: Request) => { calls.push(req); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  await api.GET('/api/health');
  expect(calls[0]?.url).toBe('http://localhost:3000/api/health');
  expect(calls[0]?.headers.get('x-requested-with')).toBe('fetch');
});

test('toApiError extrae detail y code', () => {
  const e = toApiError(401, { detail: 'No autorizado.', code: 'unauthorized' });
  expect(e).toBeInstanceOf(ApiError);
  expect(e.code).toBe('unauthorized');
});
```

Run: `npm test` → Expected: FAIL.

- [ ] **Paso 3: Implementar el cliente**

`src/api/client.ts`:

```ts
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

export class ApiError extends Error {
  constructor(public status: number, public detail: string, public code: string) { super(detail); }
}

export function toApiError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { detail?: unknown; code?: unknown };
  const detail = typeof b.detail === 'string' ? b.detail : 'Algo salió mal. Intentá de nuevo.';
  const code = typeof b.code === 'string' ? b.code : 'unknown';
  return new ApiError(status, detail, code);
}

const csrf: Middleware = {
  async onRequest({ request }) {
    request.headers.set('X-Requested-With', 'fetch');
    return request;
  },
  async onResponse({ response }) {
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      throw toApiError(response.status, body);
    }
    return response;
  },
};

export const api = createClient<paths>({ baseUrl: '/', credentials: 'include' });
api.use(csrf);
```

`src/api/health.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: async () => (await api.GET('/api/health')).data! });
}
```

`HomePage` muestra `API: {data?.status} · v{data?.version}` debajo del subtítulo.

- [ ] **Paso 4: Correr tests y verificar en navegador**

Run: `npm test && npm run typecheck` → PASS.
Navegador interno: Home muestra `API: ok · v3.0.0`; `read_network_requests urlPattern: /api/health` → 200 JSON.

- [ ] **Paso 5: Commit**

```bash
git add apps/web scripts && git commit -m "feat(web): cliente openapi-fetch con tipos generados y header anti-CSRF"
```

---

### Tarea 5: Dockerfiles, nginx (mismo origen) y docker-compose dev

**Archivos:**
- Crear: `infra/Dockerfile.api`, `infra/Dockerfile.web`, `infra/nginx/nginx.conf`, `infra/nginx/security-headers.conf`, `infra/docker-compose.dev.yml`, `apps/api/.dockerignore`, `apps/web/.dockerignore`, `scripts/dev.ps1`

**Interfaces:**
- Produce: imagen `api` (comando por defecto `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2`), imagen `web` (nginx :80), red interna con hosts `postgres`, `api`, `web`.

- [ ] **Paso 1: `Dockerfile.api`**

```dockerfile
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy MALLOC_ARENA_MAX=2
COPY --from=ghcr.io/astral-sh/uv:0.10.10 /uv /bin/uv
WORKDIR /srv
RUN groupadd -r app && useradd -r -g app -d /srv app
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/ ./
RUN uv sync --frozen --no-dev && mkdir -p /data/replay /data/telemetry /data/fastf1-cache && chown -R app:app /data /srv
USER app
ENV PATH="/srv/.venv/bin:$PATH"
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3).status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
```

- [ ] **Paso 2: `Dockerfile.web`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /src
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /src/dist /usr/share/nginx/html
RUN mkdir -p /data/replay
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
```

- [ ] **Paso 3: nginx**

`infra/nginx/security-headers.conf`:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
```

`infra/nginx/nginx.conf`:

```nginx
worker_processes auto;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on; tcp_nopush on; server_tokens off;
  client_max_body_size 1m;
  gzip on; gzip_types text/plain text/css application/json application/javascript image/svg+xml application/manifest+json; gzip_min_length 1024;
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  upstream api { server api:8000; }

  server {
    listen 80;
    root /usr/share/nginx/html;
    include /etc/nginx/security-headers.conf;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location = /healthz { return 200 "ok"; add_header Content-Type text/plain; }

    location /api/ {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 120s;
    }

    location ^~ /replay/ {
      root /data;
      gzip_static on;
      types { application/octet-stream bin; application/json json; }
      add_header Cache-Control "public, max-age=31536000, immutable" always;
      include /etc/nginx/security-headers.conf;
      try_files $uri =404;
    }

    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable" always; include /etc/nginx/security-headers.conf; try_files $uri =404; }
    location = /sw.js { add_header Cache-Control "no-cache" always; include /etc/nginx/security-headers.conf; }
    location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache" always; include /etc/nginx/security-headers.conf; }
  }
}
```

- [ ] **Paso 4: `docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment: { POSTGRES_USER: f1, POSTGRES_PASSWORD: f1dev, POSTGRES_DB: f1 }
    ports: ["5432:5432"]
    volumes:
      - ../infra/.data/postgres:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U f1 -d f1"], interval: 5s, timeout: 3s, retries: 10 }
  api:
    build: { context: .., dockerfile: infra/Dockerfile.api }
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
    env_file: ../apps/api/.env
    environment: { DATABASE_URL: "postgresql+asyncpg://f1:f1dev@postgres:5432/f1" }
    volumes: ["../apps/api:/srv", "../infra/.data/replay:/data/replay", "../infra/.data/telemetry:/data/telemetry"]
    ports: ["8000:8000"]
    depends_on: { postgres: { condition: service_healthy } }
  web:
    image: node:22-alpine
    working_dir: /src
    command: sh -c "npm ci && npm run dev -- --host"
    volumes: ["../apps/web:/src", "web_node_modules:/src/node_modules"]
    ports: ["5173:5173"]
    environment: { VITE_API_PROXY: "http://api:8000" }
    depends_on: [api]
volumes:
  web_node_modules: {}
```

`infra/initdb/01-test-db.sql`: `CREATE DATABASE f1_test OWNER f1;`. En `vite.config.ts`, `proxy['/api'].target = process.env.VITE_API_PROXY ?? 'http://localhost:8000'`.

- [ ] **Paso 5: `scripts/dev.ps1` (sin Docker)**

```powershell
# Levanta api (uvicorn --reload) y web (vite) en dos ventanas. Requiere Postgres nativo en :5432.
$root = Split-Path $PSScriptRoot -Parent
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\apps\api'; uv run alembic upgrade head; uv run uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\apps\web'; npm run dev"
Write-Host "web: http://localhost:5173  api: http://localhost:8000/api/docs"
```

- [ ] **Paso 6: Probar el camino con Docker (si está instalado)**

```bash
docker compose -f infra/docker-compose.dev.yml up --build -d && sleep 20 && curl -s http://localhost:8000/api/health && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

Expected: `{"status":"ok","db":"ok","version":"3.0.0"}` y `200`.

- [ ] **Paso 7: Probar la imagen de producción de web (nginx) y las reglas de proxy**

```bash
docker build -f infra/Dockerfile.web -t f1-web . && docker run -d --rm --name f1-web-test --network infra_default -p 8080:80 f1-web
curl -sI http://localhost:8080/ | grep -iE "content-security-policy|x-content-type|strict-transport"
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:8080/api/nope
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/ruta-spa
curl -sI --http1.1 -H "Upgrade: websocket" -H "Connection: Upgrade" http://localhost:8080/api/live/1 | head -1
docker stop f1-web-test
```

Expected: cabeceras presentes; `404 application/json` para `/api/nope`; `200` para `/ruta-spa`; el WS devuelve un estado de la API (404 por ahora), no HTML.

- [ ] **Paso 8: Commit**

```bash
git add infra scripts apps/api/.dockerignore apps/web/.dockerignore && git commit -m "feat(infra): Dockerfiles, nginx mismo origen con cabeceras de seguridad y compose de desarrollo"
```

---

### Tarea 6: CI en GitHub Actions

**Archivos:**
- Crear: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.gitleaks.toml`

- [ ] **Paso 1: `ci.yml`**

```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  api:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_USER: f1, POSTGRES_PASSWORD: f1dev, POSTGRES_DB: f1_test }
        ports: ["5432:5432"]
        options: --health-cmd "pg_isready -U f1" --health-interval 5s --health-timeout 3s --health-retries 10
    defaults: { run: { working-directory: apps/api } }
    env:
      ENV: test
      SECRET_KEY: cicicicicicicicicicicicicicicici
      DATABASE_URL: postgresql+asyncpg://f1:f1dev@localhost:5432/f1_test
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with: { version: "0.10.10" }
      - run: uv sync --frozen
      - run: uv run ruff check . && uv run ruff format --check .
      - run: uv run mypy
      - run: uv run pytest -m "not network" -q
      - run: uv run pip-audit --strict || true   # informativo hasta Fase 2; en Fase 2 se quita el "|| true"
  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: apps/web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: apps/web/package-lock.json }
      - run: npm ci
      - run: npm run lint && npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm audit --audit-level=high
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
  docker:
    runs-on: ubuntu-latest
    needs: [api, web]
    steps:
      - uses: actions/checkout@v4
      - run: docker build -f infra/Dockerfile.api -t api:ci .
      - run: docker build -f infra/Dockerfile.web -t web:ci .
```

`dependabot.yml`: `pip` en `/apps/api`, `npm` en `/apps/web`, `github-actions` en `/`, semanal.

- [ ] **Paso 2: Push y verificar**

```bash
git add .github .gitleaks.toml && git commit -m "ci: ruff, mypy, pytest, eslint, tsc, vitest, build, gitleaks y docker build" && git push
gh run watch --exit-status
```

Expected: 4 jobs verdes.

---

### Tarea 7: Sentry y logs estructurados con filtrado de PII

**Archivos:**
- Modificar: `apps/api/app/main.py`
- Crear: `apps/api/app/observability.py`, `apps/api/tests/test_observability.py`
- Modificar: `apps/web/src/main.tsx` (Sentry browser opcional vía `VITE_SENTRY_DSN`)

- [ ] **Paso 1: Test (falla primero)**

```python
from app.observability import scrub_event


def test_scrub_removes_cookies_auth_and_masks_email() -> None:
    ev = {"request": {"cookies": "a=b", "headers": {"Authorization": "x", "Cookie": "c"}},
          "user": {"email": "gerardo@example.com"}}
    out = scrub_event(ev, {})
    assert "cookies" not in out["request"]
    assert "Authorization" not in out["request"]["headers"]
    assert out["user"]["email"] == "g***@example.com"
```

- [ ] **Paso 2: Implementación**

`app/observability.py`:

```python
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from app.config import settings


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def scrub_event(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    req = event.get("request") or {}
    req.pop("cookies", None)
    headers = req.get("headers") or {}
    for h in ("Authorization", "Cookie", "Set-Cookie"):
        headers.pop(h, None)
    user = event.get("user") or {}
    if "email" in user:
        user["email"] = mask_email(user["email"])
    return event


def init_sentry() -> None:
    if settings.sentry_dsn:
        sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.env, release=settings.app_version,
                        send_default_pii=False, traces_sample_rate=0.1, before_send=scrub_event,
                        integrations=[FastApiIntegration(), SqlalchemyIntegration()])
```

Llamar `init_sentry()` en el `lifespan` antes del log de inicio. Agregar un middleware que ponga `request_id` (uuid4) en `structlog.contextvars` y en el header `X-Request-ID` de la respuesta.

- [ ] **Paso 3: Tests y commit**

Run: `uv run pytest -q` → PASS. Commit: `feat(api): Sentry con filtrado de PII y request_id en logs`.

---

### Tarea 8: `.claude/launch.json` para el navegador interno

**Archivos:**
- Crear: `.claude/launch.json`

- [ ] **Paso 1: Configuración**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "f1-dev", "runtimeExecutable": "docker", "runtimeArgs": ["compose", "-f", "infra/docker-compose.dev.yml", "up"], "port": 5173 },
    { "name": "web-only", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev", "--prefix", "apps/web"], "port": 5173 },
    { "name": "api-only", "runtimeExecutable": "uv", "runtimeArgs": ["run", "--project", "apps/api", "uvicorn", "app.main:app", "--reload", "--port", "8000"], "port": 8000 }
  ]
}
```

- [ ] **Paso 2: Verificación en navegador interno**

`preview_start name: "web-only"` (con la API levantada por `api-only` en otra preview, o con `f1-dev` si hay Docker). Confirmar que abre `http://localhost:5173` y que `/api/health` responde a través del proxy de Vite. Commit: `chore: configuración de preview para el navegador interno`.

---

### Tarea 9: Deploy "hello" en Easypanel + backups

**Archivos:**
- Crear: `infra/easypanel.md`

- [ ] **Paso 1: Documentar y ejecutar (en el panel, manual)**

`infra/easypanel.md` describe, paso a paso:

1. Proyecto `f1`. Servicio **Postgres** `postgres` (imagen `postgres:17`), sin Expose; copiar la URL interna de la pestaña Credentials (formato `postgres://f1:<pass>@f1_postgres:5432/f1`).
2. Servicio **App** `api`: source GitHub `gedardo/f1-predictor-pro`, rama `main`, build Dockerfile `infra/Dockerfile.api`, contexto `/`. Variables: `ENV=prod`, `SECRET_KEY`, `DATABASE_URL=postgresql+asyncpg://...` (la URL interna con driver asyncpg), `ALLOWED_ORIGINS=https://<dominio>`, `SENTRY_DSN`. Mounts: volumen `replay-assets` → `/data/replay`, volumen `telemetry` → `/data/telemetry`, volumen `fastf1-cache` → `/data/fastf1-cache`. Recursos: límite 1 GB. Sin dominio (interno).
3. Servicio **App** `worker` (desde Fase 1a): misma fuente, `command: python -m app.worker`, mismos volúmenes, límite 4 GB.
4. Servicio **App** `web`: Dockerfile `infra/Dockerfile.web`, dominio `<dominio>` con HTTPS, puerto 80, mount `replay-assets` → `/data/replay` (solo lectura). nginx resuelve `api` porque Easypanel pone los servicios del proyecto en la misma red: en `nginx.conf` el upstream es `f1_api:8000` en prod → se usa la variable `API_UPSTREAM` y `envsubst` en el entrypoint del Dockerfile.web (`CMD ["/bin/sh","-c","envsubst '$API_UPSTREAM' < /etc/nginx/nginx.conf.tpl > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]`).
5. Cloudflare: proxy naranja, SSL Full (strict), regla de caché para `/replay/*` (Cache Everything, Edge TTL 1 mes), WebSockets activados.
6. Backups: en `postgres` → pestaña Backups → proveedor S3-compatible (Backblaze B2 o Cloudflare R2), cron `0 4 * * *`, retención 14.
7. **Prueba de restauración:** `scripts/restore-test.ps1` baja el último backup, lo restaura en un Postgres local vacío y corre `SELECT count(*) FROM alembic_version` (en Fase 1a: `events`). Se ejecuta la primera vez acá y después cada trimestre.

- [ ] **Paso 2: Verificar**

```bash
curl -s https://<dominio>/api/health && curl -sI https://<dominio>/ | grep -i content-security-policy
```

Expected: JSON `ok` y CSP presente. Commit: `docs(infra): guía de Easypanel con servicios, volúmenes, Cloudflare y backups`.

---

### Tarea 10: Lighthouse CI móvil y e2e base con Playwright

**Archivos:**
- Crear: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/lighthouserc.json`
- Modificar: `.github/workflows/ci.yml` (job `e2e`)

- [ ] **Paso 1: Playwright config**

```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.CI ? undefined : { command: 'npm run dev', port: 5173, reuseExistingServer: true },
});
```

`e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
test('home carga y muestra estado de la API', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bienvenido a F1 Predictor Pro');
  await expect(page.getByText(/API: ok/)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  if (isMobile) await expect(nav).toBeVisible(); else await expect(nav).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

- [ ] **Paso 2: Lighthouse**

`lighthouserc.json`:

```json
{ "ci": { "collect": { "url": ["http://localhost:5173/"], "settings": { "preset": "mobile" } },
  "assert": { "assertions": { "categories:performance": ["error", { "minScore": 0.85 }], "categories:accessibility": ["error", { "minScore": 0.95 }], "categories:best-practices": ["warn", { "minScore": 0.9 }] } } } }
```

Job `e2e` en CI: levanta `docker compose -f infra/docker-compose.dev.yml up -d`, espera `/api/health`, corre `npx playwright install --with-deps chromium && npm run e2e` y `npx @lhci/cli autorun`.

- [ ] **Paso 3: Correr local y commit**

Run: `cd apps/web && npx playwright install chromium && npm run e2e` → 2 tests PASS (desktop y mobile).
Commit: `test(web): smoke e2e desktop/móvil y Lighthouse CI`.

---

## Criterio de "listo" de la Fase 0

- [ ] `docker compose -f infra/docker-compose.dev.yml up` levanta postgres, api y web; `scripts/dev.ps1` hace lo mismo sin Docker.
- [ ] CI verde (api, web, gitleaks, docker, e2e).
- [ ] `https://<dominio>/api/health` responde `ok` detrás de nginx + Cloudflare con cabeceras de seguridad.
- [ ] Backup diario configurado y restauración probada una vez.
- [ ] Verificación en navegador interno: Home en móvil (barra inferior) y desktop (Navbar), consola sin errores, PWA instalable (manifest y `sw.js` servidos).
