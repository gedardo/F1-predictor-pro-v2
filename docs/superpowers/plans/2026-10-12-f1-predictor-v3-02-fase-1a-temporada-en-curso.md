# Fase 1a — Temporada en curso (Jolpica): plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Sincronizar desde la API de Jolpica la temporada en curso (calendario con horarios de sesión, pilotos, equipos, circuitos, resultados de R/Q/S y standings por ronda) de forma idempotente, y mostrarla en las páginas Calendario, Evento y Campeonato, con la próxima sesión y cuenta regresiva en Inicio.

**Arquitectura:** El worker (APScheduler) corre `sync_season(year)` cada 6 h y cada 10 min en fin de semana de carrera, y procesa la cola `ingest_runs` con `pg_try_advisory_lock`. Los datos se escriben con `INSERT … ON CONFLICT DO UPDATE` (idempotente). Un `results_hash` por evento detecta cambios de resultado y encola `score_event` (lo consume la Fase 2). La API expone lecturas públicas con `Cache-Control` y `ETag`; la web las consume con TanStack Query.

**Tech Stack:** httpx (cliente Jolpica con token bucket 4 req/s y 500 req/h), SQLAlchemy 2 async, Alembic, APScheduler 3.11, uPlot (gráfico de evolución), TanStack Query.

**Spec:** `propuesta.md` §4.1 (fila Jolpica), §4.2 "Referencia" y "Resultados", §7 (Inicio, Calendario, Campeonato), §8, §10 fila "1a". **Plan maestro:** §1 D13–D15, §3.

## Restricciones globales

- Jolpica: base `https://api.jolpi.ca/ergast/f1`, **4 req/s y 500 req/h** sin auth, `User-Agent: F1PredictorPro/3.0 (+https://github.com/gedardo/f1-predictor-pro)`. Todo endpoint termina en `.json`. `limit ≤ 100`, paginar con `offset`.
- Solo temporada en curso por API (el histórico va por dumps en Fase 1b).
- Horas en UTC (`timestamptz`); Jolpica da `date` + `time` ("14:00:00Z").
- Colores de equipo en hex.
- Un job pesado a la vez: `pg_try_advisory_lock(42)`.

## Foco de revisión

1. **Cambio de horario de una sesión** (clima, fuerza mayor): el re-sync actualiza `sessions.starts_at`. Test en T5 (`test_sync_updates_session_time_on_schedule_change`).
2. **Evento sin resultados todavía** (fin de semana futuro): `session_results` vacío, `events.results_hash` nulo, `scoring_status = pending`, no se encola nada. Test en T5.
3. **Resultado que cambia después** (descalificación): `results_hash` cambia → se encola `score_event` exactamente una vez por cambio. Test en T5.
4. **Rate limit horario alcanzado** a mitad del sync: el cliente duerme en vez de fallar y el job registra `rate_limited_waits`. Test en T3 con reloj simulado.
5. **Piloto sin `code`** (Jolpica omite `code` en pilotos antiguos, y en la temporada en curso puede faltar para un reserva): `drivers.code` nullable; la UI muestra las 3 primeras letras del apellido en mayúscula como fallback. Test en T4 y T8.

---

### Tarea 1: Modelos de referencia y resultados + migración

**Archivos:**
- Crear: `apps/api/app/models/reference.py`, `app/models/results.py`, `app/models/ingest.py`
- Modificar: `app/models/__init__.py`
- Crear: `alembic/versions/0002_reference_results_ingest.py` (autogenerada y revisada)
- Test: `tests/test_models_reference.py`

**Interfaces:**
- Produce (SQLAlchemy): `Season(year)`, `Circuit(id, ref, name, locality, country, lat, lng)`, `Driver(id, ref, code, number, first_name, last_name, dob, nationality, url)`, `Team(id, ref, name, nationality, color_hex, url)`, `SeasonEntry(id, season_year, driver_id, team_id, number)`, `Event(id, season_year, round, name, official_name, circuit_id, date_start, date_end, is_sprint, scoring_status, dotd_driver_id, results_hash)`, `Session(id, event_id, type, starts_at, status, ingested_at, openf1_session_key)`, `SessionResult(id, session_id, driver_id, team_id, position, position_text, grid, status, points, time_ms, laps, q1_ms, q2_ms, q3_ms, fastest_lap_rank, source)`, `DriverStanding(id, season_year, round, driver_id, position, points, wins)`, `ConstructorStanding(id, season_year, round, team_id, position, points, wins)`, `IngestRun(id, kind, target, status, attempts, max_attempts, error, payload, started_at, finished_at, duration_ms)`, `SyncState(key, value)`.
- Enums: `SessionType = Literal["FP1","FP2","FP3","SQ","S","Q","R"]`, `SessionStatus = Literal["scheduled","live","finished","cancelled"]`, `ScoringStatus = Literal["pending","provisional","final"]`, `IngestStatus = Literal["queued","running","done","failed"]`.

- [ ] **Paso 1: Test de modelos (falla primero)**

```python
from datetime import date, datetime, UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reference import Circuit, Driver, Event, Season, Session, Team


async def test_event_sessions_roundtrip(db: AsyncSession) -> None:
    db.add(Season(year=2026))
    c = Circuit(ref="albert_park", name="Albert Park", locality="Melbourne", country="Australia", lat=-37.8497, lng=144.968)
    db.add(c)
    await db.flush()
    ev = Event(season_year=2026, round=1, name="Australian Grand Prix", circuit_id=c.id,
               date_start=date(2026, 3, 6), date_end=date(2026, 3, 8), is_sprint=False)
    db.add(ev)
    await db.flush()
    db.add(Session(event_id=ev.id, type="Q", starts_at=datetime(2026, 3, 7, 5, 0, tzinfo=UTC)))
    await db.flush()
    got = (await db.execute(select(Session).where(Session.event_id == ev.id))).scalar_one()
    assert got.type == "Q" and got.status == "scheduled" and got.starts_at.tzinfo is not None


async def test_driver_code_is_optional(db: AsyncSession) -> None:
    db.add(Driver(ref="old_driver", first_name="Juan", last_name="Fangio", nationality="Argentine"))
    await db.flush()
    d = (await db.execute(select(Driver).where(Driver.ref == "old_driver"))).scalar_one()
    assert d.code is None and d.display_code == "FAN"
```

Run: `uv run pytest tests/test_models_reference.py -v` → FAIL (import).

- [ ] **Paso 2: Modelos**

`app/models/reference.py`:

```python
from datetime import date, datetime
from typing import Literal

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

SessionType = Literal["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]
SessionStatus = Literal["scheduled", "live", "finished", "cancelled"]
ScoringStatus = Literal["pending", "provisional", "final"]
SESSION_ORDER: dict[str, int] = {"FP1": 1, "FP2": 2, "FP3": 3, "SQ": 4, "S": 5, "Q": 6, "R": 7}


class Season(Base):
    __tablename__ = "seasons"
    year: Mapped[int] = mapped_column(Integer, primary_key=True)


class Circuit(Base, TimestampMixin):
    __tablename__ = "circuits"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    locality: Mapped[str | None] = mapped_column(String(128))
    country: Mapped[str | None] = mapped_column(String(64))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)


class Driver(Base, TimestampMixin):
    __tablename__ = "drivers"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(64), unique=True)
    code: Mapped[str | None] = mapped_column(String(3), index=True)
    number: Mapped[int | None] = mapped_column(Integer)
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64))
    dob: Mapped[date | None] = mapped_column(Date)
    nationality: Mapped[str | None] = mapped_column(String(64))
    url: Mapped[str | None] = mapped_column(Text)
    headshot_url: Mapped[str | None] = mapped_column(Text)

    @property
    def display_code(self) -> str:
        return self.code or self.last_name[:3].upper()

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class Team(Base, TimestampMixin):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    nationality: Mapped[str | None] = mapped_column(String(64))
    color_hex: Mapped[str | None] = mapped_column(String(7))
    url: Mapped[str | None] = mapped_column(Text)


class SeasonEntry(Base):
    __tablename__ = "season_entries"
    __table_args__ = (UniqueConstraint("season_year", "driver_id", "team_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"))
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    number: Mapped[int | None] = mapped_column(Integer)
    driver: Mapped[Driver] = relationship()
    team: Mapped[Team] = relationship()


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("season_year", "round"), Index("ix_events_dates", "date_start", "date_end"))
    id: Mapped[int] = mapped_column(primary_key=True)
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    round: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(128))
    official_name: Mapped[str | None] = mapped_column(String(256))
    circuit_id: Mapped[int] = mapped_column(ForeignKey("circuits.id"))
    date_start: Mapped[date] = mapped_column(Date)
    date_end: Mapped[date] = mapped_column(Date)
    is_sprint: Mapped[bool] = mapped_column(Boolean, default=False)
    scoring_status: Mapped[ScoringStatus] = mapped_column(
        Enum("pending", "provisional", "final", name="scoring_status"), default="pending")
    dotd_driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"))
    results_hash: Mapped[str | None] = mapped_column(String(64))
    results_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    circuit: Mapped[Circuit] = relationship()
    sessions: Mapped[list["Session"]] = relationship(back_populates="event", order_by="Session.starts_at")


class Session(Base, TimestampMixin):
    __tablename__ = "sessions"
    __table_args__ = (UniqueConstraint("event_id", "type"), Index("ix_sessions_starts_at", "starts_at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    type: Mapped[SessionType] = mapped_column(Enum("FP1", "FP2", "FP3", "SQ", "S", "Q", "R", name="session_type"))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[SessionStatus] = mapped_column(
        Enum("scheduled", "live", "finished", "cancelled", name="session_status"), default="scheduled")
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    openf1_session_key: Mapped[int | None] = mapped_column(Integer)
    event: Mapped[Event] = relationship(back_populates="sessions")
```

`app/models/results.py`:

```python
from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String, UniqueConstraint, Index, BigInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.reference import Driver, Team


class SessionResult(Base, TimestampMixin):
    __tablename__ = "session_results"
    __table_args__ = (UniqueConstraint("session_id", "driver_id"), Index("ix_session_results_session", "session_id"))
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"))
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
    position: Mapped[int | None] = mapped_column(Integer)          # posición final (None si no clasificado)
    position_text: Mapped[str] = mapped_column(String(4))          # "1".."20", "R", "D", "W", "N"
    grid: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str | None] = mapped_column(String(64))         # "Finished", "+1 Lap", "Collision"...
    points: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    time_ms: Mapped[int | None] = mapped_column(BigInteger)
    laps: Mapped[int | None] = mapped_column(Integer)
    q1_ms: Mapped[int | None] = mapped_column(Integer)
    q2_ms: Mapped[int | None] = mapped_column(Integer)
    q3_ms: Mapped[int | None] = mapped_column(Integer)
    fastest_lap_rank: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(16), default="jolpica")
    driver: Mapped[Driver] = relationship()
    team: Mapped[Team | None] = relationship()


class DriverStanding(Base):
    __tablename__ = "driver_standings"
    __table_args__ = (UniqueConstraint("season_year", "round", "driver_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    round: Mapped[int] = mapped_column(Integer)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"))
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
    position: Mapped[int] = mapped_column(Integer)
    points: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    wins: Mapped[int] = mapped_column(Integer, default=0)


class ConstructorStanding(Base):
    __tablename__ = "constructor_standings"
    __table_args__ = (UniqueConstraint("season_year", "round", "team_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    round: Mapped[int] = mapped_column(Integer)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    position: Mapped[int] = mapped_column(Integer)
    points: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    wins: Mapped[int] = mapped_column(Integer, default=0)
```

`app/models/ingest.py`:

```python
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import DateTime, Enum, Integer, String, Text, Index, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

IngestStatus = Literal["queued", "running", "done", "failed"]


class IngestRun(Base):
    __tablename__ = "ingest_runs"
    __table_args__ = (Index("ix_ingest_runs_status_created", "status", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))       # jolpica_sync | score_event | fastf1_session | openf1_session | replay_build | jolpica_dump
    target: Mapped[str] = mapped_column(String(64))     # "2026" | "event:12" | "session:345"
    status: Mapped[IngestStatus] = mapped_column(Enum("queued", "running", "done", "failed", name="ingest_status"), default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class SyncState(Base):
    __tablename__ = "sync_state"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

`app/models/__init__.py` importa los tres módulos.

- [ ] **Paso 3: Migración**

```bash
cd apps/api && uv run alembic revision --autogenerate -m "referencia, resultados e ingesta" --rev-id 0002 && uv run alembic upgrade head
```

Revisar el archivo generado: enums creados, índices presentes, `ondelete="CASCADE"` en `sessions.event_id` y `session_results.session_id`.

- [ ] **Paso 4: Tests y commit**

Run: `uv run pytest tests/test_models_reference.py -v` → PASS.
Commit: `feat(api): modelos de referencia, resultados, standings y cola ingest_runs`.

---

### Tarea 2: Cliente Jolpica con rate limit y fixtures reales

**Archivos:**
- Crear: `app/services/jolpica.py`, `app/services/ratelimit.py`
- Crear: `tests/fixtures/jolpica/fetch_fixtures.py`, `tests/fixtures/jolpica/*.json` (generados una vez)
- Test: `tests/test_jolpica_client.py`, `tests/test_ratelimit_client.py`

**Interfaces:**
- Produce: `class JolpicaClient(http: httpx.AsyncClient, limiter: AsyncRateLimiter)` con `async def get(path: str, **params) -> dict`, `async def paginate(path: str, table: str, key: str) -> list[dict]`, y métodos `schedule(year)`, `drivers(year)`, `constructors(year)`, `results(year)`, `qualifying(year)`, `sprint(year)`, `driver_standings(year, round=None)`, `constructor_standings(year, round=None)`.
- Produce: `class AsyncRateLimiter(per_second: float, per_hour: int, clock=time.monotonic, sleep=asyncio.sleep)` con `async def acquire() -> None` y contador `waits`.

- [ ] **Paso 1: Test del limitador (falla primero)**

```python
import pytest

from app.services.ratelimit import AsyncRateLimiter


class FakeClock:
    def __init__(self) -> None: self.t = 0.0
    def __call__(self) -> float: return self.t


async def test_limiter_spaces_requests_per_second() -> None:
    clock = FakeClock(); slept: list[float] = []
    async def sleep(s: float) -> None: slept.append(s); clock.t += s
    lim = AsyncRateLimiter(per_second=4, per_hour=500, clock=clock, sleep=sleep)
    for _ in range(3): await lim.acquire()
    assert slept and all(abs(s - 0.25) < 1e-9 for s in slept)


async def test_limiter_waits_when_hourly_quota_exhausted() -> None:
    clock = FakeClock(); slept: list[float] = []
    async def sleep(s: float) -> None: slept.append(s); clock.t += s
    lim = AsyncRateLimiter(per_second=1000, per_hour=3, clock=clock, sleep=sleep)
    for _ in range(3): await lim.acquire()
    await lim.acquire()                      # 4ª: debe esperar hasta liberar la ventana de 1 h
    assert max(slept) >= 3600 - 1e-6 and lim.waits == 1
```

- [ ] **Paso 2: Limitador**

```python
import asyncio
import time
from collections import deque
from collections.abc import Awaitable, Callable


class AsyncRateLimiter:
    def __init__(self, per_second: float, per_hour: int,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
        self._min_gap = 1.0 / per_second
        self._per_hour = per_hour
        self._clock, self._sleep = clock, sleep
        self._last = -1e9
        self._hour: deque[float] = deque()
        self._lock = asyncio.Lock()
        self.waits = 0

    async def acquire(self) -> None:
        async with self._lock:
            now = self._clock()
            while self._hour and now - self._hour[0] >= 3600:
                self._hour.popleft()
            if len(self._hour) >= self._per_hour:
                wait = 3600 - (now - self._hour[0])
                self.waits += 1
                await self._sleep(wait)
                now = self._clock()
                while self._hour and now - self._hour[0] >= 3600:
                    self._hour.popleft()
            gap = now - self._last
            if gap < self._min_gap:
                await self._sleep(self._min_gap - gap)
                now = self._clock()
            self._last = now
            self._hour.append(now)
```

Run: `uv run pytest tests/test_ratelimit_client.py -v` → PASS.

- [ ] **Paso 3: Fixtures reales (una vez, con red)**

`tests/fixtures/jolpica/fetch_fixtures.py` baja y guarda (con `limit=100`): `2025.json` (schedule), `2025_drivers.json`, `2025_constructors.json`, `2025_results_p0.json` (offset 0), `2025_qualifying_p0.json`, `2025_sprint.json`, `2025_driverstandings.json`, `2025_constructorstandings.json`, `2025_3_driverstandings.json` (ronda 3). Se ejecuta con `uv run python tests/fixtures/jolpica/fetch_fixtures.py` y se commitean los JSON (son < 1 MB en total). Se usa 2025 porque está completa y estable.

- [ ] **Paso 4: Test del cliente con transporte simulado (falla primero)**

```python
import json
from pathlib import Path

import httpx

from app.services.jolpica import JolpicaClient
from app.services.ratelimit import AsyncRateLimiter

FIX = Path(__file__).parent / "fixtures" / "jolpica"


def _transport(routes: dict[str, str]) -> httpx.MockTransport:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["user-agent"].startswith("F1PredictorPro/")
        key = req.url.path.removeprefix("/ergast/f1/") + ("?" + req.url.query.decode() if req.url.query else "")
        for pattern, file in routes.items():
            if key.startswith(pattern):
                return httpx.Response(200, json=json.loads((FIX / file).read_text()))
        return httpx.Response(404, json={})
    return httpx.MockTransport(handler)


async def test_schedule_parses_sessions() -> None:
    http = httpx.AsyncClient(transport=_transport({"2025.json": "2025.json"}), base_url="https://api.jolpi.ca/ergast/f1")
    client = JolpicaClient(http, AsyncRateLimiter(1000, 100000))
    races = await client.schedule(2025)
    assert len(races) >= 20
    assert races[0]["round"] == "1" and "Qualifying" in races[0]


async def test_paginate_merges_pages() -> None:
    page = json.loads((FIX / "2025_results_p0.json").read_text())
    total = int(page["MRData"]["total"])
    http = httpx.AsyncClient(transport=_transport({"2025/results.json": "2025_results_p0.json"}), base_url="https://api.jolpi.ca/ergast/f1")
    client = JolpicaClient(http, AsyncRateLimiter(1000, 100000))
    races = await client.results(2025)
    assert sum(len(r["Results"]) for r in races) >= min(total, 100)
```

- [ ] **Paso 5: Cliente**

```python
from typing import Any

import httpx
import structlog

from app.services.ratelimit import AsyncRateLimiter

log = structlog.get_logger()
BASE_URL = "https://api.jolpi.ca/ergast/f1"
USER_AGENT = "F1PredictorPro/3.0 (+https://github.com/gedardo/f1-predictor-pro)"


def make_http() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=BASE_URL, headers={"User-Agent": USER_AGENT}, timeout=30.0)


class JolpicaClient:
    def __init__(self, http: httpx.AsyncClient, limiter: AsyncRateLimiter | None = None) -> None:
        self.http = http
        self.limiter = limiter or AsyncRateLimiter(per_second=4, per_hour=500)

    async def get(self, path: str, **params: Any) -> dict[str, Any]:
        await self.limiter.acquire()
        for attempt in range(3):
            r = await self.http.get(path, params=params)
            if r.status_code == 429 or r.status_code >= 500:
                log.warning("jolpica.retry", path=path, status=r.status_code, attempt=attempt)
                await self.limiter._sleep(2.0 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()["MRData"]
        r.raise_for_status()
        return r.json()["MRData"]

    async def paginate(self, path: str, table: str, key: str) -> list[dict[str, Any]]:
        """Devuelve la lista completa de `MRData[table][key]` concatenando páginas de 100."""
        out: list[dict[str, Any]] = []
        offset = 0
        while True:
            data = await self.get(path, limit=100, offset=offset)
            items = data.get(table, {}).get(key, [])
            out.extend(items)
            total = int(data.get("total", 0))
            offset += 100
            if offset >= total or not items:
                return out

    async def schedule(self, year: int) -> list[dict[str, Any]]:
        return await self.paginate(f"/{year}.json", "RaceTable", "Races")

    async def drivers(self, year: int) -> list[dict[str, Any]]:
        return await self.paginate(f"/{year}/drivers.json", "DriverTable", "Drivers")

    async def constructors(self, year: int) -> list[dict[str, Any]]:
        return await self.paginate(f"/{year}/constructors.json", "ConstructorTable", "Constructors")

    async def _races_with(self, path: str, key: str) -> list[dict[str, Any]]:
        """Resultados vienen anidados por carrera y paginados por fila: fusiona por round."""
        merged: dict[str, dict[str, Any]] = {}
        for race in await self.paginate(path, "RaceTable", "Races"):
            slot = merged.setdefault(race["round"], {**race, key: []})
            slot[key].extend(race.get(key, []))
        return [merged[r] for r in sorted(merged, key=int)]

    async def results(self, year: int) -> list[dict[str, Any]]:
        return await self._races_with(f"/{year}/results.json", "Results")

    async def qualifying(self, year: int) -> list[dict[str, Any]]:
        return await self._races_with(f"/{year}/qualifying.json", "QualifyingResults")

    async def sprint(self, year: int) -> list[dict[str, Any]]:
        return await self._races_with(f"/{year}/sprint.json", "SprintResults")

    async def driver_standings(self, year: int, round: int | None = None) -> list[dict[str, Any]]:
        path = f"/{year}/{round}/driverstandings.json" if round else f"/{year}/driverstandings.json"
        lists = (await self.get(path, limit=100)).get("StandingsTable", {}).get("StandingsLists", [])
        return lists[0]["DriverStandings"] if lists else []

    async def constructor_standings(self, year: int, round: int | None = None) -> list[dict[str, Any]]:
        path = f"/{year}/{round}/constructorstandings.json" if round else f"/{year}/constructorstandings.json"
        lists = (await self.get(path, limit=100)).get("StandingsTable", {}).get("StandingsLists", [])
        return lists[0]["ConstructorStandings"] if lists else []
```

Run: `uv run pytest tests/test_jolpica_client.py -v` → PASS. Commit: `feat(api): cliente Jolpica con rate limit (4/s, 500/h), paginación y fixtures reales`.

---

### Tarea 3: Mapeadores puros Jolpica → filas

**Archivos:**
- Crear: `app/services/jolpica_map.py`, `app/services/team_colors.py`
- Test: `tests/test_jolpica_map.py`

**Interfaces:**
- Produce: `parse_utc(date: str, time: str | None) -> datetime | None`, `parse_lap_time_ms("1:20.123") -> int | None`, `map_circuit(j) -> dict`, `map_driver(j) -> dict`, `map_team(j) -> dict`, `map_event(j) -> dict` (sin ids), `map_sessions(j) -> list[tuple[SessionType, datetime|None]]`, `map_race_result(j) -> dict`, `map_quali_result(j) -> dict`, `map_sprint_result(j) -> dict`, `results_hash(rows: list[dict]) -> str`, `TEAM_COLORS: dict[str, str]`.

- [ ] **Paso 1: Tests (fallan primero)**

```python
from datetime import datetime, UTC

from app.services.jolpica_map import map_sessions, parse_lap_time_ms, parse_utc, results_hash, map_race_result


def test_parse_utc_and_lap_time() -> None:
    assert parse_utc("2026-03-07", "05:00:00Z") == datetime(2026, 3, 7, 5, 0, tzinfo=UTC)
    assert parse_utc("2026-03-07", None) is None
    assert parse_lap_time_ms("1:20.123") == 80123 and parse_lap_time_ms("") is None


def test_map_sessions_sprint_weekend() -> None:
    race = {"date": "2026-03-22", "time": "07:00:00Z",
            "FirstPractice": {"date": "2026-03-20", "time": "03:30:00Z"},
            "SprintQualifying": {"date": "2026-03-20", "time": "07:30:00Z"},
            "Sprint": {"date": "2026-03-21", "time": "03:00:00Z"},
            "Qualifying": {"date": "2026-03-21", "time": "07:00:00Z"}}
    types = [t for t, _ in map_sessions(race)]
    assert types == ["FP1", "SQ", "S", "Q", "R"]


def test_results_hash_is_order_independent_and_changes_with_status() -> None:
    a = [{"session": "R", "driver": "ver", "position_text": "1", "points": "25", "status": "Finished", "fastest_lap_rank": 1}]
    b = [{"session": "R", "driver": "ver", "position_text": "D", "points": "0", "status": "Disqualified", "fastest_lap_rank": 1}]
    assert results_hash(a) == results_hash(list(reversed(a)))
    assert results_hash(a) != results_hash(b)


def test_map_race_result_dsq() -> None:
    row = map_race_result({"position": "20", "positionText": "D", "points": "0", "grid": "3", "laps": "57",
                           "status": "Disqualified", "Driver": {"driverId": "ver"}, "Constructor": {"constructorId": "red_bull"}})
    assert row["position"] is None and row["position_text"] == "D" and row["driver_ref"] == "ver"
```

- [ ] **Paso 2: Implementación**

```python
import hashlib
import json
from datetime import datetime, UTC
from typing import Any

SESSION_KEYS: list[tuple[str, str]] = [
    ("FirstPractice", "FP1"), ("SecondPractice", "FP2"), ("ThirdPractice", "FP3"),
    ("SprintQualifying", "SQ"), ("SprintShootout", "SQ"), ("Sprint", "S"), ("Qualifying", "Q"),
]


def parse_utc(date: str | None, time: str | None) -> datetime | None:
    if not date or not time:
        return None
    return datetime.fromisoformat(f"{date}T{time.replace('Z', '+00:00')}").astimezone(UTC)


def parse_lap_time_ms(s: str | None) -> int | None:
    if not s:
        return None
    mins, _, rest = s.rpartition(":")
    sec = float(rest)
    return int(round((int(mins) * 60 if mins else 0) * 1000 + sec * 1000))


def map_circuit(j: dict[str, Any]) -> dict[str, Any]:
    loc = j.get("Location", {})
    return {"ref": j["circuitId"], "name": j["circuitName"], "locality": loc.get("locality"),
            "country": loc.get("country"), "lat": float(loc["lat"]) if "lat" in loc else None,
            "lng": float(loc["long"]) if "long" in loc else None}


def map_driver(j: dict[str, Any]) -> dict[str, Any]:
    return {"ref": j["driverId"], "code": j.get("code"), "number": int(j["permanentNumber"]) if j.get("permanentNumber") else None,
            "first_name": j["givenName"], "last_name": j["familyName"],
            "dob": j.get("dateOfBirth"), "nationality": j.get("nationality"), "url": j.get("url")}


def map_team(j: dict[str, Any]) -> dict[str, Any]:
    from app.services.team_colors import TEAM_COLORS
    return {"ref": j["constructorId"], "name": j["name"], "nationality": j.get("nationality"), "url": j.get("url"),
            "color_hex": TEAM_COLORS.get(j["constructorId"], "#9CA3AF")}


def map_event(j: dict[str, Any]) -> dict[str, Any]:
    sessions = map_sessions(j)
    starts = [dt for _, dt in sessions if dt]
    race_dt = parse_utc(j["date"], j.get("time"))
    return {"round": int(j["round"]), "name": j["raceName"], "circuit_ref": j["Circuit"]["circuitId"],
            "date_start": min(starts).date() if starts else datetime.fromisoformat(j["date"]).date(),
            "date_end": (race_dt.date() if race_dt else datetime.fromisoformat(j["date"]).date()),
            "is_sprint": "Sprint" in j}


def map_sessions(j: dict[str, Any]) -> list[tuple[str, datetime | None]]:
    out: list[tuple[str, datetime | None]] = []
    for key, stype in SESSION_KEYS:
        if key in j:
            out.append((stype, parse_utc(j[key].get("date"), j[key].get("time"))))
    out.append(("R", parse_utc(j["date"], j.get("time"))))
    return out


def _pos(j: dict[str, Any]) -> int | None:
    pt = j.get("positionText", "")
    return int(pt) if pt.isdigit() else None


def map_race_result(j: dict[str, Any]) -> dict[str, Any]:
    t = j.get("Time", {}) or {}
    fl = j.get("FastestLap", {}) or {}
    return {"driver_ref": j["Driver"]["driverId"], "team_ref": j.get("Constructor", {}).get("constructorId"),
            "position": _pos(j), "position_text": j.get("positionText", ""), "grid": int(j["grid"]) if j.get("grid") else None,
            "status": j.get("status"), "points": j.get("points", "0"),
            "time_ms": int(t["millis"]) if t.get("millis") else None, "laps": int(j["laps"]) if j.get("laps") else None,
            "fastest_lap_rank": int(fl["rank"]) if fl.get("rank") else None}


def map_sprint_result(j: dict[str, Any]) -> dict[str, Any]:
    return map_race_result(j)


def map_quali_result(j: dict[str, Any]) -> dict[str, Any]:
    return {"driver_ref": j["Driver"]["driverId"], "team_ref": j.get("Constructor", {}).get("constructorId"),
            "position": _pos(j), "position_text": j.get("position", ""), "grid": None, "status": None, "points": "0",
            "q1_ms": parse_lap_time_ms(j.get("Q1")), "q2_ms": parse_lap_time_ms(j.get("Q2")), "q3_ms": parse_lap_time_ms(j.get("Q3"))}


def results_hash(rows: list[dict[str, Any]]) -> str:
    canon = sorted(json.dumps({k: rows_i[k] for k in ("session", "driver", "position_text", "points", "status", "fastest_lap_rank")}, sort_keys=True) for rows_i in rows)
    return hashlib.sha256("\n".join(canon).encode()).hexdigest()
```

`app/services/team_colors.py`: `TEAM_COLORS = {"red_bull": "#3671C6", "ferrari": "#E8002D", "mercedes": "#27F4D2", "mclaren": "#FF8000", "aston_martin": "#229971", "alpine": "#0093CC", "williams": "#64C4FF", "rb": "#6692FF", "sauber": "#52E252", "haas": "#B6BABD", "audi": "#F50537", "cadillac": "#1D1D1B"}` — al correr el primer sync de 2026, confirmar los `constructorId` reales en `/2026/constructors.json` y ajustar las claves de los equipos nuevos.

Run: `uv run pytest tests/test_jolpica_map.py -v` → PASS. Commit: `feat(api): mapeadores Jolpica → filas con hash de resultados`.

---

### Tarea 4: Repositorio de upserts idempotentes

**Archivos:**
- Crear: `app/services/reference_repo.py`
- Test: `tests/test_reference_repo.py`

**Interfaces:**
- Produce: `async def upsert_circuits(db, rows) -> dict[str, int]` (ref→id), `upsert_drivers(db, rows) -> dict[str, int]`, `upsert_teams(db, rows) -> dict[str, int]`, `upsert_event(db, year, row, circuit_id) -> int`, `upsert_sessions(db, event_id, sessions) -> dict[str, int]` (type→id), `upsert_session_results(db, session_id, rows, driver_ids, team_ids, source="jolpica") -> int`, `upsert_season_entries(db, year, pairs: set[tuple[int, int, int|None]])`, `upsert_standings(db, year, round, drivers_rows, teams_rows)`.

- [ ] **Paso 1: Test (falla primero)**

```python
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reference import Driver, Season
from app.services.reference_repo import upsert_drivers


async def test_upsert_drivers_is_idempotent_and_updates(db: AsyncSession) -> None:
    db.add(Season(year=2026)); await db.flush()
    rows = [{"ref": "ver", "code": "VER", "number": 1, "first_name": "Max", "last_name": "Verstappen", "dob": None, "nationality": "Dutch", "url": None}]
    ids1 = await upsert_drivers(db, rows)
    rows[0]["number"] = 3
    ids2 = await upsert_drivers(db, rows)
    assert ids1 == ids2
    assert (await db.scalar(select(func.count()).select_from(Driver))) == 1
    assert (await db.scalar(select(Driver.number).where(Driver.ref == "ver"))) == 3
```

- [ ] **Paso 2: Implementación (patrón para todas las tablas)**

```python
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reference import Circuit, Driver, Event, SeasonEntry, Session, Team
from app.models.results import ConstructorStanding, DriverStanding, SessionResult


async def _upsert_by_ref(db: AsyncSession, model: type[Any], rows: list[dict[str, Any]], update_cols: list[str]) -> dict[str, int]:
    if not rows:
        return {}
    stmt = insert(model).values(rows)
    stmt = stmt.on_conflict_do_update(index_elements=["ref"], set_={c: getattr(stmt.excluded, c) for c in update_cols})
    await db.execute(stmt)
    refs = [r["ref"] for r in rows]
    res = await db.execute(select(model.ref, model.id).where(model.ref.in_(refs)))
    return {ref: id_ for ref, id_ in res.all()}


async def upsert_circuits(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, int]:
    return await _upsert_by_ref(db, Circuit, rows, ["name", "locality", "country", "lat", "lng"])


async def upsert_drivers(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, int]:
    return await _upsert_by_ref(db, Driver, rows, ["code", "number", "first_name", "last_name", "dob", "nationality", "url"])


async def upsert_teams(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, int]:
    return await _upsert_by_ref(db, Team, rows, ["name", "nationality", "url", "color_hex"])


async def upsert_event(db: AsyncSession, year: int, row: dict[str, Any], circuit_id: int) -> int:
    values = {"season_year": year, "round": row["round"], "name": row["name"], "circuit_id": circuit_id,
              "date_start": row["date_start"], "date_end": row["date_end"], "is_sprint": row["is_sprint"]}
    stmt = insert(Event).values(values).on_conflict_do_update(
        index_elements=["season_year", "round"],
        set_={k: v for k, v in values.items() if k not in ("season_year", "round")}).returning(Event.id)
    return int((await db.execute(stmt)).scalar_one())


async def upsert_sessions(db: AsyncSession, event_id: int, sessions: list[tuple[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for stype, starts_at in sessions:
        stmt = insert(Session).values(event_id=event_id, type=stype, starts_at=starts_at).on_conflict_do_update(
            index_elements=["event_id", "type"], set_={"starts_at": starts_at}).returning(Session.id)
        out[stype] = int((await db.execute(stmt)).scalar_one())
    return out


async def upsert_session_results(db: AsyncSession, session_id: int, rows: list[dict[str, Any]],
                                 driver_ids: dict[str, int], team_ids: dict[str, int], source: str = "jolpica") -> int:
    values = []
    for r in rows:
        values.append({"session_id": session_id, "driver_id": driver_ids[r["driver_ref"]],
                       "team_id": team_ids.get(r.get("team_ref") or ""), "position": r["position"],
                       "position_text": r["position_text"], "grid": r.get("grid"), "status": r.get("status"),
                       "points": r.get("points", "0"), "time_ms": r.get("time_ms"), "laps": r.get("laps"),
                       "q1_ms": r.get("q1_ms"), "q2_ms": r.get("q2_ms"), "q3_ms": r.get("q3_ms"),
                       "fastest_lap_rank": r.get("fastest_lap_rank"), "source": source})
    if not values:
        return 0
    stmt = insert(SessionResult).values(values)
    cols = [c for c in values[0] if c not in ("session_id", "driver_id")]
    await db.execute(stmt.on_conflict_do_update(index_elements=["session_id", "driver_id"],
                                                set_={c: getattr(stmt.excluded, c) for c in cols}))
    return len(values)


async def upsert_season_entries(db: AsyncSession, year: int, pairs: set[tuple[int, int, int | None]]) -> None:
    for driver_id, team_id, number in pairs:
        stmt = insert(SeasonEntry).values(season_year=year, driver_id=driver_id, team_id=team_id, number=number)
        await db.execute(stmt.on_conflict_do_update(index_elements=["season_year", "driver_id", "team_id"], set_={"number": number}))


async def upsert_standings(db: AsyncSession, year: int, round: int,
                           drivers_rows: list[dict[str, Any]], teams_rows: list[dict[str, Any]]) -> None:
    if drivers_rows:
        s = insert(DriverStanding).values([{"season_year": year, "round": round, **r} for r in drivers_rows])
        await db.execute(s.on_conflict_do_update(index_elements=["season_year", "round", "driver_id"],
                                                 set_={"position": s.excluded.position, "points": s.excluded.points, "wins": s.excluded.wins, "team_id": s.excluded.team_id}))
    if teams_rows:
        s = insert(ConstructorStanding).values([{"season_year": year, "round": round, **r} for r in teams_rows])
        await db.execute(s.on_conflict_do_update(index_elements=["season_year", "round", "team_id"],
                                                 set_={"position": s.excluded.position, "points": s.excluded.points, "wins": s.excluded.wins}))
```

Run: `uv run pytest tests/test_reference_repo.py -v` → PASS. Commit: `feat(api): upserts idempotentes de referencia, resultados y standings`.

---

### Tarea 5: Job `sync_season` (idempotente, detección de cambios, encolado)

**Archivos:**
- Crear: `app/worker/__init__.py`, `app/worker/jobs/__init__.py`, `app/worker/jobs/jolpica_sync.py`, `app/worker/queue.py`
- Test: `tests/test_jolpica_sync.py`

**Interfaces:**
- Produce: `async def sync_season(db: AsyncSession, client: JolpicaClient, year: int, *, now: datetime | None = None) -> SyncReport` con `SyncReport(events: int, sessions: int, results: int, standings_rounds: int, changed_events: list[int], rate_limited_waits: int)`.
- Produce: `async def enqueue(db, kind: str, target: str, payload: dict | None = None, *, dedupe: bool = True) -> int | None` (no encola si ya hay uno `queued` con mismo kind+target).

- [ ] **Paso 1: Tests (fallan primero)**

```python
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingest import IngestRun
from app.models.reference import Event, Session
from app.models.results import SessionResult
from app.services.jolpica import JolpicaClient
from app.services.ratelimit import AsyncRateLimiter
from app.worker.jobs.jolpica_sync import sync_season

FIX = Path(__file__).parent / "fixtures" / "jolpica"


def make_client(overrides: dict[str, dict] | None = None) -> JolpicaClient:
    files = {"2025.json": "2025.json", "2025/drivers.json": "2025_drivers.json", "2025/constructors.json": "2025_constructors.json",
             "2025/results.json": "2025_results_p0.json", "2025/qualifying.json": "2025_qualifying_p0.json",
             "2025/sprint.json": "2025_sprint.json", "2025/driverstandings.json": "2025_driverstandings.json",
             "2025/constructorstandings.json": "2025_constructorstandings.json"}
    def handler(req: httpx.Request) -> httpx.Response:
        key = req.url.path.removeprefix("/ergast/f1/")
        if overrides and key in overrides:
            return httpx.Response(200, json=overrides[key])
        for k, f in files.items():
            if key == k:
                return httpx.Response(200, json=json.loads((FIX / f).read_text()))
        if key.endswith("driverstandings.json") or key.endswith("constructorstandings.json"):
            return httpx.Response(200, json=json.loads((FIX / "2025_3_driverstandings.json").read_text()))
        return httpx.Response(404, json={})
    return JolpicaClient(httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://api.jolpi.ca/ergast/f1"), AsyncRateLimiter(10000, 10**6))


async def test_sync_twice_is_idempotent(db: AsyncSession) -> None:
    r1 = await sync_season(db, make_client(), 2025)
    n_events = await db.scalar(select(func.count()).select_from(Event))
    n_results = await db.scalar(select(func.count()).select_from(SessionResult))
    r2 = await sync_season(db, make_client(), 2025)
    assert r1.events == r2.events >= 20
    assert await db.scalar(select(func.count()).select_from(Event)) == n_events
    assert await db.scalar(select(func.count()).select_from(SessionResult)) == n_results
    assert r2.changed_events == []          # segunda pasada: sin cambios


async def test_sync_updates_session_time_on_schedule_change(db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    sched = json.loads((FIX / "2025.json").read_text())
    sched["MRData"]["RaceTable"]["Races"][0]["Qualifying"]["time"] = "09:00:00Z"
    await sync_season(db, make_client({"2025.json": sched}), 2025)
    ev = (await db.execute(select(Event).where(Event.season_year == 2025, Event.round == 1))).scalar_one()
    q = (await db.execute(select(Session).where(Session.event_id == ev.id, Session.type == "Q"))).scalar_one()
    assert q.starts_at.astimezone(UTC).hour == 9


async def test_result_change_enqueues_score_event_once(db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    res = json.loads((FIX / "2025_results_p0.json").read_text())
    first = res["MRData"]["RaceTable"]["Races"][0]["Results"][0]
    first["positionText"], first["status"], first["points"] = "D", "Disqualified", "0"
    await sync_season(db, make_client({"2025/results.json": res}), 2025)
    await sync_season(db, make_client({"2025/results.json": res}), 2025)
    runs = (await db.execute(select(IngestRun).where(IngestRun.kind == "score_event"))).scalars().all()
    assert len(runs) == 1 and runs[0].target == "event:" + str((await db.scalar(select(Event.id).where(Event.round == 1, Event.season_year == 2025))))


async def test_future_event_has_no_results_and_pending_status(db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    last = (await db.execute(select(Event).where(Event.season_year == 2025).order_by(Event.round.desc()))).scalars().first()
    assert last is not None
    if await db.scalar(select(func.count()).select_from(SessionResult).join(Session).where(Session.event_id == last.id)) == 0:
        assert last.scoring_status == "pending" and last.results_hash is None
```

- [ ] **Paso 2: Cola**

`app/worker/queue.py`:

```python
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingest import IngestRun


async def enqueue(db: AsyncSession, kind: str, target: str, payload: dict[str, Any] | None = None, *, dedupe: bool = True) -> int | None:
    if dedupe:
        existing = await db.scalar(select(IngestRun.id).where(IngestRun.kind == kind, IngestRun.target == target,
                                                              IngestRun.status.in_(("queued", "running"))))
        if existing:
            return None
    run = IngestRun(kind=kind, target=target, payload=payload or {})
    db.add(run)
    await db.flush()
    return run.id
```

- [ ] **Paso 3: Job**

`app/worker/jobs/jolpica_sync.py`:

```python
from dataclasses import dataclass, field
from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingest import SyncState
from app.models.reference import Event, Season, Session
from app.models.results import DriverStanding
from app.services import jolpica_map as m
from app.services.jolpica import JolpicaClient
from app.services.reference_repo import (upsert_circuits, upsert_drivers, upsert_event, upsert_season_entries,
                                         upsert_session_results, upsert_sessions, upsert_standings, upsert_teams)
from app.worker.queue import enqueue

log = structlog.get_logger()


@dataclass
class SyncReport:
    events: int = 0
    sessions: int = 0
    results: int = 0
    standings_rounds: int = 0
    changed_events: list[int] = field(default_factory=list)
    rate_limited_waits: int = 0


async def sync_season(db: AsyncSession, client: JolpicaClient, year: int, *, now: datetime | None = None,
                      max_standings_rounds: int = 6) -> SyncReport:
    now = now or datetime.now(UTC)
    rep = SyncReport()
    await db.execute(insert(Season).values(year=year).on_conflict_do_nothing())

    schedule = await client.schedule(year)
    circuit_ids = await upsert_circuits(db, [m.map_circuit(r["Circuit"]) for r in schedule])
    driver_ids = await upsert_drivers(db, [m.map_driver(d) for d in await client.drivers(year)])
    team_ids = await upsert_teams(db, [m.map_team(t) for t in await client.constructors(year)])

    event_ids: dict[int, int] = {}
    session_ids: dict[int, dict[str, int]] = {}
    for race in schedule:
        ev = m.map_event(race)
        eid = await upsert_event(db, year, ev, circuit_ids[ev["circuit_ref"]])
        event_ids[ev["round"]] = eid
        session_ids[ev["round"]] = await upsert_sessions(db, eid, m.map_sessions(race))
        rep.events += 1
        rep.sessions += len(session_ids[ev["round"]])

    per_event_rows: dict[int, list[dict]] = {}
    entries: set[tuple[int, int, int | None]] = set()
    sources = [("R", await client.results(year), m.map_race_result, "Results"),
               ("Q", await client.qualifying(year), m.map_quali_result, "QualifyingResults"),
               ("S", await client.sprint(year), m.map_sprint_result, "SprintResults")]
    for stype, races, mapper, key in sources:
        for race in races:
            rnd = int(race["round"])
            rows = [mapper(r) for r in race.get(key, [])]
            if not rows or stype not in session_ids.get(rnd, {}):
                continue
            missing = {r["driver_ref"] for r in rows} - driver_ids.keys()
            if missing:
                driver_ids.update(await upsert_drivers(db, [m.map_driver(r["Driver"]) for r in race[key] if r["Driver"]["driverId"] in missing]))
            rep.results += await upsert_session_results(db, session_ids[rnd][stype], rows, driver_ids, team_ids)
            await db.execute(Session.__table__.update().where(Session.id == session_ids[rnd][stype]).values(status="finished"))
            for r in rows:
                if r.get("team_ref") in team_ids:
                    entries.add((driver_ids[r["driver_ref"]], team_ids[r["team_ref"]], None))
                per_event_rows.setdefault(rnd, []).append({"session": stype, "driver": r["driver_ref"], "position_text": r["position_text"],
                                                           "points": r["points"], "status": r.get("status"), "fastest_lap_rank": r.get("fastest_lap_rank")})
    await upsert_season_entries(db, year, entries)

    for rnd, rows in per_event_rows.items():
        h = m.results_hash(rows)
        ev = await db.get(Event, event_ids[rnd])
        assert ev is not None
        if ev.results_hash != h:
            changed = ev.results_hash is not None
            ev.results_hash, ev.results_changed_at = h, now
            if ev.scoring_status == "pending":
                ev.scoring_status = "provisional"
            elif changed:
                ev.scoring_status = "provisional"
            await enqueue(db, "score_event", f"event:{ev.id}", {"reason": "results_changed" if changed else "results_published"})
            rep.changed_events.append(ev.id)

    # Standings: actual + histórico por ronda que falte (limitado por corrida para respetar 500/h)
    completed = sorted(per_event_rows)
    if completed:
        latest = completed[-1]
        have = set((await db.execute(select(DriverStanding.round).where(DriverStanding.season_year == year).distinct())).scalars())
        todo = [r for r in completed if r not in have][-max_standings_rounds:]
        if latest not in todo and latest not in have:
            todo.append(latest)
        for rnd in todo:
            d_rows = [{"driver_id": driver_ids[s["Driver"]["driverId"]], "team_id": team_ids.get((s.get("Constructors") or [{}])[-1].get("constructorId", "")),
                       "position": int(s["position"]), "points": s["points"], "wins": int(s.get("wins", 0))}
                      for s in await client.driver_standings(year, rnd) if s["Driver"]["driverId"] in driver_ids]
            t_rows = [{"team_id": team_ids[s["Constructor"]["constructorId"]], "position": int(s["position"]), "points": s["points"], "wins": int(s.get("wins", 0))}
                      for s in await client.constructor_standings(year, rnd) if s["Constructor"]["constructorId"] in team_ids]
            await upsert_standings(db, year, rnd, d_rows, t_rows)
            rep.standings_rounds += 1

    rep.rate_limited_waits = client.limiter.waits
    await db.execute(insert(SyncState).values(key=f"jolpica:{year}", value={"last_sync": now.isoformat(), "events": rep.events, "results": rep.results})
                     .on_conflict_do_update(index_elements=["key"], set_={"value": {"last_sync": now.isoformat(), "events": rep.events, "results": rep.results}}))
    await db.commit()
    log.info("jolpica.sync.done", year=year, **rep.__dict__)
    return rep
```

Run: `uv run pytest tests/test_jolpica_sync.py -v` → 4 PASS. Commit: `feat(worker): sync idempotente de temporada con detección de cambios y encolado de scoring`.

---

### Tarea 6: Worker (APScheduler + runner de cola con advisory lock) y CLI

**Archivos:**
- Crear: `app/worker/__main__.py`, `app/worker/scheduler.py`, `app/worker/runner.py`
- Test: `tests/test_queue_runner.py`

**Interfaces:**
- Produce: `python -m app.worker` (daemon), `python -m app.worker sync --year 2026`, `python -m app.worker run-queue --once`.
- Produce: `HANDLERS: dict[str, Callable[[AsyncSession, IngestRun], Awaitable[None]]]` registro extensible (Fase 2 registra `score_event`, Fase 3 `fastf1_session`…).
- Produce: `async def run_queue_once(db) -> int` (procesa como máximo 1 run; devuelve 1 si procesó).

- [ ] **Paso 1: Test del runner (falla primero)**

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingest import IngestRun
from app.worker.queue import enqueue
from app.worker.runner import HANDLERS, run_queue_once


async def test_runner_marks_done_and_retries_then_fails(db: AsyncSession) -> None:
    calls = {"n": 0}
    async def flaky(db_: AsyncSession, run: IngestRun) -> None:
        calls["n"] += 1
        raise RuntimeError("boom")
    HANDLERS["flaky"] = flaky
    rid = await enqueue(db, "flaky", "x")
    for _ in range(3):
        assert await run_queue_once(db) == 1
    run = await db.get(IngestRun, rid)
    assert run is not None and run.status == "failed" and run.attempts == 3 and "boom" in (run.error or "")
    assert await run_queue_once(db) == 0


async def test_runner_done_path(db: AsyncSession) -> None:
    async def ok(db_: AsyncSession, run: IngestRun) -> None: return None
    HANDLERS["ok"] = ok
    rid = await enqueue(db, "ok", "y")
    assert await run_queue_once(db) == 1
    run = await db.get(IngestRun, rid)
    assert run is not None and run.status == "done" and run.duration_ms is not None
```

- [ ] **Paso 2: Runner**

```python
import time
import traceback
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingest import IngestRun

log = structlog.get_logger()
HANDLERS: dict[str, Callable[[AsyncSession, IngestRun], Awaitable[None]]] = {}
LOCK_ID = 42


async def run_queue_once(db: AsyncSession) -> int:
    got = await db.scalar(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID})
    if not got:
        return 0
    try:
        run = (await db.execute(select(IngestRun).where(IngestRun.status == "queued").order_by(IngestRun.created_at).limit(1)
                                .with_for_update(skip_locked=True))).scalar_one_or_none()
        if run is None:
            return 0
        handler = HANDLERS.get(run.kind)
        run.status, run.attempts, run.started_at = "running", run.attempts + 1, datetime.now(UTC)
        await db.flush()
        t0 = time.monotonic()
        try:
            if handler is None:
                raise RuntimeError(f"sin handler para kind={run.kind}")
            await handler(db, run)
            run.status, run.error = "done", None
        except Exception as exc:  # noqa: BLE001
            run.error = f"{exc}\n{traceback.format_exc()[-2000:]}"
            run.status = "failed" if run.attempts >= run.max_attempts else "queued"
            log.warning("ingest.run.error", id=run.id, kind=run.kind, attempts=run.attempts, status=run.status)
        run.finished_at = datetime.now(UTC)
        run.duration_ms = int((time.monotonic() - t0) * 1000)
        await db.flush()
        return 1
    finally:
        await db.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
```

Nota: en tests la sesión comparte conexión, así que el lock se toma y suelta en la misma conexión; en producción cada iteración abre su sesión.

- [ ] **Paso 3: Scheduler y CLI**

`app/worker/scheduler.py`:

```python
from datetime import UTC, date, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.db import SessionLocal
from app.models.reference import Event
from app.services.jolpica import JolpicaClient, make_http
from app.worker.jobs.jolpica_sync import sync_season
from app.worker.runner import run_queue_once

_http = make_http()
_client = JolpicaClient(_http)


def current_year() -> int:
    return datetime.now(UTC).year


async def job_sync_current_season() -> None:
    async with SessionLocal() as db:
        await sync_season(db, _client, current_year())


async def job_sync_if_race_weekend() -> None:
    today = date.today()
    async with SessionLocal() as db:
        active = await db.scalar(select(Event.id).where(Event.date_start - timedelta(days=1) <= today, Event.date_end + timedelta(days=2) >= today).limit(1))
        if active:
            await sync_season(db, _client, current_year())


async def job_run_queue() -> None:
    async with SessionLocal() as db:
        while await run_queue_once(db):
            await db.commit()
        await db.commit()


def build_scheduler() -> AsyncIOScheduler:
    s = AsyncIOScheduler(timezone="UTC")
    s.add_job(job_sync_current_season, "interval", hours=6, id="sync6h", next_run_time=datetime.now(UTC))
    s.add_job(job_sync_if_race_weekend, "interval", minutes=10, id="syncweekend")
    s.add_job(job_run_queue, "interval", seconds=30, id="queue", max_instances=1, coalesce=True)
    return s
```

`app/worker/__main__.py`:

```python
import argparse
import asyncio

from app.db import SessionLocal
from app.logging import configure_logging
from app.observability import init_sentry
from app.worker.scheduler import _client, build_scheduler, job_run_queue
from app.worker.jobs.jolpica_sync import sync_season


async def _daemon() -> None:
    build_scheduler().start()
    while True:
        await asyncio.sleep(3600)


async def _sync(year: int) -> None:
    async with SessionLocal() as db:
        rep = await sync_season(db, _client, year)
        print(rep)


def main() -> None:
    configure_logging(); init_sentry()
    p = argparse.ArgumentParser(prog="app.worker")
    sub = p.add_subparsers(dest="cmd")
    s = sub.add_parser("sync"); s.add_argument("--year", type=int, required=True)
    q = sub.add_parser("run-queue"); q.add_argument("--once", action="store_true")
    args = p.parse_args()
    if args.cmd == "sync":
        asyncio.run(_sync(args.year))
    elif args.cmd == "run-queue":
        asyncio.run(job_run_queue())
    else:
        asyncio.run(_daemon())


if __name__ == "__main__":
    main()
```

Agregar `apscheduler>=3.11,<4` a `pyproject.toml`; en `docker-compose.dev.yml` servicio `worker` (misma imagen que `api`, `command: ["python", "-m", "app.worker"]`).

- [ ] **Paso 4: Correr el sync real de 2026 y verificar**

```bash
cd apps/api && uv run python -m app.worker sync --year 2026
```

Expected: `SyncReport(events=24…, results=…, rate_limited_waits=0)`. Verificar en DB: `SELECT round, name, is_sprint FROM events WHERE season_year=2026 ORDER BY round;` muestra el calendario 2026 completo y `SELECT ref FROM teams` incluye los 11 equipos (confirmar `constructorId` de los nuevos y ajustar `TEAM_COLORS`).

Run tests: `uv run pytest -q` → PASS. Commit: `feat(worker): APScheduler, runner de cola con advisory lock y CLI de sync`.

---

### Tarea 7: Endpoints públicos de temporada, evento, sesión y standings

**Archivos:**
- Crear: `app/schemas/reference.py`, `app/routers/seasons.py`, `app/routers/events.py`, `app/routers/sessions.py`, `app/routers/standings.py`, `app/routers/cache.py`
- Modificar: `app/main.py`
- Test: `tests/test_public_endpoints.py`

**Interfaces:**
- Produce (Pydantic, `from_attributes=True`): `DriverOut(id, ref, code, number, first_name, last_name, nationality, headshot_url)`, `TeamOut(id, ref, name, color_hex)`, `CircuitOut(id, ref, name, locality, country)`, `SessionOut(id, type, starts_at, status, ingested_at)`, `EventOut(id, season_year, round, name, circuit, date_start, date_end, is_sprint, scoring_status, sessions: list[SessionOut])`, `SessionResultOut(driver, team, position, position_text, grid, status, points, time_ms, laps, q1_ms, q2_ms, q3_ms, fastest_lap_rank)`, `SessionDetailOut(session: SessionOut, event: EventOut, results: list[SessionResultOut])`, `StandingRowOut(position, points, wins, driver?: DriverOut, team?: TeamOut)`, `StandingsOut(season, round, rows)`, `NextSessionOut(event, session, starts_in_seconds)`.
- Endpoints: `GET /api/seasons`, `GET /api/seasons/{year}/events`, `GET /api/seasons/{year}/next-session`, `GET /api/events/{id}`, `GET /api/sessions/{id}`, `GET /api/standings/{year}/drivers?round=`, `GET /api/standings/{year}/constructors?round=`, `GET /api/standings/{year}/drivers/progression` (puntos por ronda por piloto para el gráfico).
- Produce: decorador `public_cache(seconds=60)` que setea `Cache-Control: public, max-age=N` y `ETag` (sha1 del body).

- [ ] **Paso 1: Tests (fallan primero)**

```python
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_jolpica_sync import make_client
from app.worker.jobs.jolpica_sync import sync_season


async def test_events_list_has_sessions_and_cache_headers(client: AsyncClient, db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    r = await client.get("/api/seasons/2025/events")
    assert r.status_code == 200
    body = r.json()
    assert len(body) >= 20 and body[0]["sessions"][0]["type"] == "FP1"
    assert r.headers["cache-control"] == "public, max-age=60" and "etag" in r.headers
    r2 = await client.get("/api/seasons/2025/events", headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304


async def test_session_detail_and_404(client: AsyncClient, db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    ev = (await client.get("/api/seasons/2025/events")).json()[0]
    race = next(s for s in ev["sessions"] if s["type"] == "R")
    r = await client.get(f"/api/sessions/{race['id']}")
    assert r.status_code == 200 and r.json()["results"][0]["position"] == 1
    assert (await client.get("/api/sessions/999999")).status_code == 404


async def test_standings_latest_and_by_round(client: AsyncClient, db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    r = await client.get("/api/standings/2025/drivers")
    assert r.status_code == 200 and r.json()["rows"][0]["position"] == 1 and r.json()["rows"][0]["driver"]["code"]
    r3 = await client.get("/api/standings/2025/drivers", params={"round": 3})
    assert r3.status_code == 200 and r3.json()["round"] == 3
```

- [ ] **Paso 2: Implementación**

`app/routers/cache.py`:

```python
import hashlib
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any

import orjson
from fastapi import Request, Response


def public_cache(seconds: int = 60) -> Callable[..., Any]:
    def deco(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @wraps(fn)
        async def wrapper(request: Request, response: Response, *a: Any, **kw: Any) -> Any:
            data = await fn(*a, **kw)
            body = orjson.dumps(data, default=lambda o: o.model_dump(mode="json") if hasattr(o, "model_dump") else str(o))
            etag = '"' + hashlib.sha1(body).hexdigest()[:16] + '"'  # noqa: S324
            response.headers["Cache-Control"] = f"public, max-age={seconds}"
            response.headers["ETag"] = etag
            if request.headers.get("if-none-match") == etag:
                return Response(status_code=304, headers={"ETag": etag, "Cache-Control": f"public, max-age={seconds}"})
            return data
        return wrapper
    return deco
```

`app/routers/events.py` (patrón; `seasons.py`, `sessions.py`, `standings.py` siguen igual):

```python
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.errors import ApiError
from app.models.reference import Event
from app.routers.cache import public_cache
from app.schemas.reference import EventOut

router = APIRouter(tags=["events"])


@router.get("/seasons/{year}/events", response_model=list[EventOut])
@public_cache(60)
async def list_events(year: int, db: AsyncSession = Depends(get_db)) -> list[EventOut]:
    q = select(Event).where(Event.season_year == year).options(selectinload(Event.sessions), selectinload(Event.circuit)).order_by(Event.round)
    return [EventOut.model_validate(e) for e in (await db.execute(q)).scalars()]


@router.get("/events/{event_id}", response_model=EventOut)
@public_cache(60)
async def get_event(event_id: int, db: AsyncSession = Depends(get_db)) -> EventOut:
    ev = await db.get(Event, event_id, options=[selectinload(Event.sessions), selectinload(Event.circuit)])
    if ev is None:
        raise ApiError(404, "Evento no encontrado.", "event_not_found")
    return EventOut.model_validate(ev)
```

Nota de firma: FastAPI inyecta `request` y `response` porque el wrapper los declara; el decorador debe copiar la firma original agregándolas (`inspect.signature` + `functools.wraps` con `__signature__` reemplazada). Implementar eso en `public_cache` para que `/api/docs` muestre los parámetros correctos.

`next-session`: la sesión con `starts_at > now()` más cercana del año, con `starts_in_seconds`. `progression`: `SELECT round, driver_id, points FROM driver_standings WHERE season_year=:y ORDER BY round` agrupado por piloto → `{rounds: [1..n], series: [{driver: DriverOut, points: [..]}]}`.

- [ ] **Paso 3: Tests, regenerar tipos y commit**

Run: `uv run pytest -q` → PASS. `cd apps/web && npm run gen:api`. Commit: `feat(api): endpoints públicos de temporada, evento, sesión y standings con caché y ETag`.

---

### Tarea 8: Web — Calendario, Evento y Campeonato (responsive)

**Archivos:**
- Crear: `src/api/seasons.ts` (hooks `useEvents(year)`, `useEvent(id)`, `useSession(id)`, `useStandings(year, kind, round?)`, `useProgression(year)`, `useNextSession(year)`)
- Crear: `src/lib/dates.ts` (`formatDateTime`, `formatCountdown`, `useNow(intervalMs)`), `src/lib/season.ts` (`CURRENT_YEAR` desde `/api/seasons`), `src/lib/drivers.ts` (`driverCode(d)`, `driverName(d)`)
- Crear: `src/features/calendar/CalendarPage.tsx`, `src/features/calendar/EventCard.tsx`, `src/features/event/EventPage.tsx`, `src/features/event/SessionTabs.tsx`, `src/features/event/ResultsTable.tsx`, `src/features/standings/StandingsPage.tsx`, `src/features/standings/StandingsTable.tsx`, `src/features/standings/ProgressionChart.tsx`, `src/components/ui/Countdown.tsx`, `src/components/ui/TeamDot.tsx`, `src/components/ui/EmptyState.tsx`, `src/components/ui/ErrorState.tsx`
- Modificar: `src/routes.tsx` (`/calendario`, `/eventos/:id`, `/campeonato`), `src/i18n/es.ts`, `src/features/home/HomePage.tsx` (próxima sesión + cuenta regresiva)
- Test: `tests/dates.test.ts`, `tests/ResultsTable.test.tsx`

**Interfaces:**
- Consume: tipos generados `components['schemas']['EventOut']` etc.
- Produce: componentes exportados con props tipadas por los schemas.

- [ ] **Paso 1: Tests (fallan primero)**

```ts
// tests/dates.test.ts
import { formatCountdown, formatDateTime } from '@/lib/dates';
test('cuenta regresiva en español', () => {
  expect(formatCountdown(3 * 86400 + 4 * 3600 + 5 * 60)).toBe('3 d 4 h 5 min');
  expect(formatCountdown(65)).toBe('1 min 5 s');
  expect(formatCountdown(-10)).toBe('En curso');
});
test('fecha local es-AR', () => {
  expect(formatDateTime('2026-03-07T05:00:00Z', 'UTC')).toMatch(/7 de mar/i);
});
```

```tsx
// tests/ResultsTable.test.tsx
import { render, screen } from '@testing-library/react';
import { ResultsTable } from '@/features/event/ResultsTable';
const row = (p: number, code: string | null, last: string) => ({ driver: { id: p, ref: last.toLowerCase(), code, number: p, first_name: 'X', last_name: last, nationality: null, headshot_url: null },
  team: { id: 1, ref: 't', name: 'Equipo', color_hex: '#ff0000' }, position: p, position_text: String(p), grid: p, status: 'Finished', points: '25', time_ms: 5400000, laps: 57, q1_ms: null, q2_ms: null, q3_ms: null, fastest_lap_rank: null });
test('muestra código fallback cuando el piloto no tiene code', () => {
  render(<ResultsTable type="R" rows={[row(1, 'VER', 'Verstappen'), row(2, null, 'Fangio')]} />);
  expect(screen.getByText('VER')).toBeInTheDocument();
  expect(screen.getByText('FAN')).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveAccessibleName('Resultados de la carrera');
});
```

- [ ] **Paso 2: Implementación**

`src/lib/dates.ts`:

```ts
import { useEffect, useState } from 'react';

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'En curso';
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  if (d > 0) return `${d} d ${h} h ${m} min`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min ${s} s`;
}
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}
```

`ResultsTable.tsx`: `<div className="overflow-x-auto -mx-4 sm:mx-0"><table aria-label={label} className="w-full text-sm"><thead>…</thead>` con columnas por tipo: R/S → Pos, Piloto (código en móvil, nombre completo en `sm+` con `hidden sm:inline`), Equipo (`TeamDot` color), Grilla (`hidden md:table-cell`), Tiempo/Estado, Pts; Q → Pos, Piloto, Equipo, Q1, Q2, Q3 (Q1/Q2 `hidden sm:table-cell`). Primera columna `sticky left-0 bg-surface`. Filas `min-h-11`.

`CalendarPage.tsx`: `h1` "Calendario {year}", lista `grid gap-3 sm:grid-cols-2 xl:grid-cols-3` de `EventCard` (ronda, nombre, circuito, país, fechas locales, chip "Sprint", estado: "Próximo" / "En curso" / "Finalizado", próxima sesión con `Countdown`). Click → `/eventos/:id`. Estados `EmptyState` y `ErrorState` (con botón "Reintentar").

`EventPage.tsx`: cabecera (nombre, circuito, fechas), `SessionTabs` (tabs horizontales scrolleables en móvil, `role="tablist"`, teclas ←/→) con una tab por sesión en orden `FP1…R`; cada tab muestra hora local, estado y, si `status === 'finished'`, `ResultsTable` del `useSession(id)`; si no, "Resultados pendientes". Tab `Replay`/`Análisis` aparecen deshabilitadas con tooltip "Disponible próximamente" hasta Fase 3/4.

`StandingsPage.tsx`: toggle Pilotos/Constructores (`role="radiogroup"`), selector de ronda (`<select>` con "Actual" y rondas disputadas), `StandingsTable` (Pos, Piloto/Equipo, Pts, Victorias) y `ProgressionChart` (uPlot, una serie por piloto top 10, colores de equipo, `width` responsive con `ResizeObserver`, leyenda táctil). uPlot se importa dinámicamente (`React.lazy`) para no engordar el bundle inicial.

`HomePage.tsx`: tarjeta "Próxima sesión" con `useNextSession` → nombre del evento, tipo de sesión en español (`FP1` → "Práctica 1", `SQ` → "Qualy sprint", `S` → "Sprint", `Q` → "Clasificación", `R` → "Carrera"), hora local y `Countdown`. Enlaces a Calendario y Campeonato.

Claves i18n nuevas (todas en `es.ts`): `calendar_title`, `calendar_empty`, `event_sessions`, `event_results_pending`, `event_sprint_badge`, `status_upcoming`, `status_live`, `status_finished`, `standings_title`, `standings_drivers`, `standings_constructors`, `standings_round_current`, `standings_progression`, `results_table_race`, `results_table_quali`, `col_pos`, `col_driver`, `col_team`, `col_grid`, `col_time`, `col_points`, `col_wins`, `home_next_session`, `retry`, `session_FP1`…`session_R`.

- [ ] **Paso 3: Tests, lint, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build` → PASS; bundle inicial sigue < 250 kB gz (uPlot en chunk aparte).

- [ ] **Paso 4: Verificación en navegador interno**

1. `preview_start name: "f1-dev"` (o `api-only` + `web-only`). Con la DB sincronizada con 2026 (`python -m app.worker sync --year 2026`).
2. Móvil (375×812): `/calendario` → tarjetas en una columna, chip Sprint visible, cuenta regresiva corriendo; screenshot. Tocar un evento → `/eventos/:id`: tabs scrolleables, tabla de resultados con primera columna fija y scroll horizontal sin scroll de página; screenshot. `/campeonato`: toggle, select de ronda, tabla legible, gráfico ocupa el ancho; screenshot.
3. Desktop: las tres pantallas; screenshot.
4. `read_console_messages onlyErrors: true` vacío; `read_network_requests urlPattern: /api/` → 200 con `cache-control: public, max-age=60`; segunda carga de `/calendario` → 304 en `events`.
5. Inicio muestra la próxima sesión 2026 con cuenta regresiva correcta respecto de la hora local.

- [ ] **Paso 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): calendario, evento con tabs de sesión y campeonato con evolución por ronda"
```

---

### Tarea 9: Panel admin mínimo de ingesta (solo lectura, protegido en Fase 2)

**Archivos:**
- Crear: `app/routers/admin.py` (`GET /api/admin/ingest-runs?status=&limit=`, `POST /api/admin/sync/{year}`), por ahora con dependencia `require_admin_placeholder` que en esta fase exige header `X-Admin-Token == settings.admin_bootstrap_token` (variable `ADMIN_BOOTSTRAP_TOKEN`, solo dev) y que la Fase 2 T10 reemplaza por `require_admin` con rol en DB. **No desplegar a prod con el placeholder: en `prod` el endpoint responde 404 si `ADMIN_BOOTSTRAP_TOKEN` no está definido.**
- Test: `tests/test_admin_ingest.py` (lista runs; 401 sin token; 404 en prod sin token configurado).

- [ ] **Paso 1: Test, implementación, commit**

Implementar como arriba; `POST /api/admin/sync/{year}` encola `jolpica_sync` con target `str(year)` y el runner registra el handler `jolpica_sync` en `scheduler.py` (`HANDLERS["jolpica_sync"] = lambda db, run: sync_season(db, _client, int(run.target))`). Commit: `feat(api): endpoints admin de cola de ingesta y sync manual (protección provisoria)`.

---

## Criterio de "listo" de la Fase 1a

- [ ] `python -m app.worker sync --year 2026` deja la temporada 2026 completa (calendario, sesiones con hora UTC, pilotos, equipos con color, resultados y standings por ronda de las rondas disputadas).
- [ ] Correrlo dos veces no cambia conteos ni encola nada (idempotente).
- [ ] Un cambio de resultado (test con DSQ) encola `score_event` una sola vez y el evento queda `provisional`.
- [ ] Calendario, Evento y Campeonato verificados en el navegador interno en móvil y desktop, sin errores de consola, con caché 60 s y 304.
- [ ] Worker desplegado en Easypanel (`command: python -m app.worker`) y `GET /api/admin/ingest-runs` muestra los syncs.
