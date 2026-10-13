# Fase 2 — Usuarios + juego (paridad segura): plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Auth propia completa (registro con verificación de email, login, refresh rotativo, logout, reset, borrado de cuenta), perfil, predicciones con cierre en el servidor, fantasy con snapshots, scoring automático versionado con re-scoring idempotente, rankings global y por liga, "Adiviná el piloto" validado en el servidor, panel admin por rol, usuarios de prueba y pruebas e2e + navegador interno.

**Arquitectura:** Módulo `app/auth` (argon2id, JWT de acceso 15 min en cookie httpOnly, refresh opaco rotativo con familia y detección de reuso, CSRF por header + Origin, rate limit en Postgres, mailer intercambiable). Dominio de juego en `app/services/*` con reglas puras en `app/scoring/v2026.py` (sin DB) y un runner que reemplaza `score_entries` por evento en una transacción. El worker consume `score_event` (encolado por la Fase 1a al publicarse/cambiar resultados) y toma snapshots de fantasy al cierre de la qualy. Nada de puntos se calcula ni se escribe desde el cliente.

**Tech Stack:** argon2-cffi, PyJWT, email-validator, aiosmtplib, Pydantic v2, SQLAlchemy 2 async, APScheduler; web: TanStack Query, react-router 8, componentes de juego migrados de v2 (`Keyboard`, `KeyboardKey`, `GuessInputRow`).

**Spec:** `propuesta.md` §3 (fila Auth), §4.2 "Usuarios" y "Juego", §6 (tabla completa), §7 (Predicciones, Mi Equipo, Rankings, Adiviná, Perfil/Reglas/Auth, Admin), §8, §10 fila "2". Reglas de puntuación: `constants.ts` de v2 (`SCORING_RULES`) y `types.ts` (`F1_POINTS_SYSTEM`, `F1_SPRINT_POINTS_SYSTEM`). **Plan maestro:** §1 D4, D7–D10; §3.1 (seguridad, obligatorio); §3.7 (usuarios de prueba).

## Restricciones globales

- argon2id; access JWT 15 min; refresh rotativo con hash en DB; cookies httpOnly/Secure(prod)/SameSite=Lax; verificación de email y reset por SMTP; rate limit en Postgres; rol en DB; borrado de cuenta.
- Cierre de predicciones **en el servidor**: qualy/carrera al inicio de Q, sprint/SQ al inicio de SQ (`PREDICTION_LOCK_OFFSET_MINUTES`, default 0).
- Fantasy: snapshot congelado por evento al cierre; cambios cuentan desde el evento siguiente; `changes_remaining` lo controla el servidor; sin punto por vuelta rápida; puntos de sprint.
- Scoring idempotente: reemplaza los `score_entries` del evento en una transacción; `scoring_status` provisional → final (DOTD cargado + 7 días sin cambios, `SCORING_FINALIZE_DAYS=7`).
- Adiviná el piloto: objetivo elegido por el servidor; validación de cada intento; límite diario por `user_id` + fecha UTC (3 partidas, 5 intentos, 10 pts por victoria, +20 por 3/3).
- Admin: `users.role = 'admin'` verificado en cada endpoint.
- `score_entries.detail` explica cada punto en español ("Pole VER +10").

## Foco de revisión

1. **Guardar la predicción justo al cierre:** la comparación `now() >= lock` se hace en la misma transacción del UPSERT con `now()` de Postgres, no del cliente ni de Python. Test T5 (`test_put_prediction_at_exact_lock_time_is_rejected`).
2. **Descalificación posterior a la carrera:** cambia `results_hash`, el runner recalcula y los puntos de quienes acertaron al descalificado desaparecen; la suma del ranking cambia en consecuencia. Test T8 (`test_rescore_after_dsq_replaces_entries`).
3. **Reuso de refresh token robado:** usar un refresh ya rotado revoca toda la familia y obliga a loguear de nuevo. Test T3.
4. **Usuario que se registra después del cierre de la qualy:** no tiene snapshot de fantasy para ese evento → 0 puntos de fantasy, sin error. Test T7.
5. **Enumeración de emails** en registro/forgot: misma respuesta y tiempo similar. Test T3 (`test_forgot_same_response_for_unknown_email`).

---

### Tarea 1: Modelos de usuarios y juego + migración + función de rate limit

**Archivos:**
- Crear: `app/models/users.py`, `app/models/game.py`
- Modificar: `app/models/__init__.py`
- Crear: `alembic/versions/0003_users_game.py` (autogenerada + SQL manual de `bump_rate_limit` e índices parciales)
- Test: `tests/test_models_users.py`

**Interfaces:**
- `User(id: UUID, email, password_hash, role, email_verified_at, is_active, last_login_at)`, `Profile(user_id, nickname, avatar_url, country, timezone)`, `RefreshToken(id, user_id, token_hash, family_id, expires_at, revoked_at, replaced_by_id, user_agent, ip)`, `EmailToken(id, user_id, purpose, token_hash, expires_at, used_at)`, `AdminAuditLog(id, user_id, action, target, payload, at)`.
- `Prediction(id, user_id, event_id, quali_top3: list[int|None], sprint_top3: list[int|None]|None, race_top10: list[int|None], fastest_lap_driver_id, dotd_driver_id)`, `FantasyTeam(user_id, season_year, driver_ids: list[int], team_ids: list[int], changes_remaining)`, `FantasySnapshot(id, user_id, event_id, driver_ids, team_ids, taken_at)`, `ScoreEntry(id, user_id, season_year, event_id|None, day|None, category, points, detail, computed_at)`, `League(id, name, code, owner_id, season_year)`, `LeagueMember(league_id, user_id, joined_at)`, `GuessGame(id, user_id, day, target_driver_id, attempts: list[dict], status, points)`.
- SQL: `bump_rate_limit(p_key text, p_limit int, p_window_seconds int) RETURNS boolean`.

- [ ] **Paso 1: Test (falla primero)**

```python
import uuid
from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game import Prediction, ScoreEntry
from app.models.users import Profile, User


async def test_user_profile_and_prediction(db: AsyncSession) -> None:
    u = User(email="x@f1pp.test", password_hash="h", role="user")
    db.add(u); await db.flush()
    db.add(Profile(user_id=u.id, nickname="xx1"))
    await db.flush()
    assert isinstance(u.id, uuid.UUID)


async def test_bump_rate_limit_function(db: AsyncSession) -> None:
    ok = [await db.scalar(text("SELECT bump_rate_limit('t:1', 2, 60)")) for _ in range(3)]
    assert ok == [True, True, False]


async def test_score_entry_unique_per_event_and_category(db: AsyncSession) -> None:
    u = User(email="y@f1pp.test", password_hash="h"); db.add(u); await db.flush()
    db.add(ScoreEntry(user_id=u.id, season_year=2026, day=date(2026, 3, 1), category="guess", points=10, detail={}))
    await db.flush()
```

- [ ] **Paso 2: Modelos**

`app/models/users.py`:

```python
import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, Index, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

Role = Literal["user", "admin"]


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (Index("ux_users_email_lower", func.lower("email"), unique=True),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email: Mapped[str] = mapped_column(String(254))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[Role] = mapped_column(Enum("user", "admin", name="user_role"), default="user")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    profile: Mapped["Profile"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)

    @property
    def is_verified(self) -> bool:
        return self.email_verified_at is not None


class Profile(Base, TimestampMixin):
    __tablename__ = "profiles"
    __table_args__ = (Index("ux_profiles_nick_lower", func.lower("nickname"), unique=True),)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    nickname: Mapped[str] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(String(2))
    timezone: Mapped[str | None] = mapped_column(String(64))
    user: Mapped[User] = relationship(back_populates="profile")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (Index("ix_refresh_user", "user_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    user_agent: Mapped[str | None] = mapped_column(String(256))
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EmailToken(Base):
    __tablename__ = "email_tokens"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[Literal["verify", "reset"]] = mapped_column(Enum("verify", "reset", name="email_token_purpose"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

`app/models/game.py`:

```python
import uuid
from datetime import date, datetime
from typing import Any, Literal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, Index, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

ScoreCategory = Literal["prediction", "fantasy", "guess"]


class Prediction(Base, TimestampMixin):
    __tablename__ = "predictions"
    __table_args__ = (UniqueConstraint("user_id", "event_id"), Index("ix_predictions_event", "event_id"))
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    quali_top3: Mapped[list[int | None]] = mapped_column(JSONB, default=lambda: [None, None, None])
    sprint_top3: Mapped[list[int | None] | None] = mapped_column(JSONB)
    race_top10: Mapped[list[int | None]] = mapped_column(JSONB, default=lambda: [None] * 10)
    fastest_lap_driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"))
    dotd_driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"))


class FantasyTeam(Base, TimestampMixin):
    __tablename__ = "fantasy_teams"
    __table_args__ = (UniqueConstraint("user_id", "season_year"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    driver_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    team_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    changes_remaining: Mapped[int] = mapped_column(Integer, default=5)


class FantasySnapshot(Base):
    __tablename__ = "fantasy_snapshots"
    __table_args__ = (UniqueConstraint("user_id", "event_id"), Index("ix_fantasy_snapshots_event", "event_id"))
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    driver_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    team_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ScoreEntry(Base):
    __tablename__ = "score_entries"
    __table_args__ = (
        Index("ix_score_entries_season_user", "season_year", "user_id"),
        Index("ix_score_entries_event", "event_id"),
        Index("ux_score_entries_event_cat", "user_id", "event_id", "category", unique=True, postgresql_where="event_id IS NOT NULL"),
        Index("ux_score_entries_day_cat", "user_id", "day", "category", unique=True, postgresql_where="day IS NOT NULL"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    day: Mapped[date | None] = mapped_column(Date)
    category: Mapped[ScoreCategory] = mapped_column(Enum("prediction", "fantasy", "guess", name="score_category"))
    points: Mapped[int] = mapped_column(Integer)
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class League(Base, TimestampMixin):
    __tablename__ = "leagues"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    code: Mapped[str] = mapped_column(String(8), unique=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    season_year: Mapped[int] = mapped_column(ForeignKey("seasons.year"))
    members: Mapped[list["LeagueMember"]] = relationship(cascade="all, delete-orphan")


class LeagueMember(Base):
    __tablename__ = "league_members"
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GuessGame(Base):
    __tablename__ = "guess_games"
    __table_args__ = (Index("ix_guess_games_user_day", "user_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    target_driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"))
    attempts: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    status: Mapped[Literal["playing", "won", "lost"]] = mapped_column(Enum("playing", "won", "lost", name="guess_status"), default="playing")
    points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Paso 3: Migración con SQL manual**

`uv run alembic revision --autogenerate -m "usuarios y juego" --rev-id 0003`, y agregar al final de `upgrade()`:

```python
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("""
    CREATE TABLE rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count int NOT NULL)""")
    op.execute("""
    CREATE OR REPLACE FUNCTION bump_rate_limit(p_key text, p_limit int, p_window_seconds int) RETURNS boolean
    LANGUAGE plpgsql AS $$
    DECLARE v_count int;
    BEGIN
      INSERT INTO rate_limits(key, window_start, count) VALUES (p_key, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => p_window_seconds) THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => p_window_seconds) THEN now() ELSE rate_limits.window_start END
      RETURNING count INTO v_count;
      RETURN v_count <= p_limit;
    END $$""")
```

y en `downgrade()` los `DROP`. Run: `uv run alembic upgrade head && uv run pytest tests/test_models_users.py -v` → PASS. Commit: `feat(api): modelos de usuarios, tokens, juego y función bump_rate_limit`.

---

### Tarea 2: Auth puro: contraseñas, tokens, cookies, CSRF, rate limit, mailer

**Archivos:**
- Crear: `app/auth/__init__.py`, `app/auth/passwords.py`, `app/auth/common_passwords.txt` (10k de SecLists `10k-most-common.txt`), `app/auth/tokens.py`, `app/auth/cookies.py`, `app/auth/csrf.py`, `app/auth/ratelimit.py`, `app/auth/mail.py`, `app/auth/templates/verify.txt`, `app/auth/templates/reset.txt`
- Modificar: `app/config.py` (campos: `access_token_minutes=15`, `refresh_token_days=30`, `mail_backend: Literal["console","smtp"]="console"`, `smtp_host`, `smtp_port=587`, `smtp_user`, `smtp_password`, `mail_from="F1 Predictor Pro <no-reply@f1pp.test>"`, `public_base_url="http://localhost:5173"`, `prediction_lock_offset_minutes=0`, `scoring_finalize_days=7`, `seed_password: str | None`)
- Modificar: `pyproject.toml` (`argon2-cffi`, `pyjwt`, `email-validator`, `aiosmtplib`)
- Test: `tests/auth/test_passwords.py`, `tests/auth/test_tokens.py`, `tests/auth/test_csrf.py`, `tests/auth/test_ratelimit.py`, `tests/auth/test_mail.py`

**Interfaces:**
- `hash_password(p: str) -> str`, `verify_password(p: str, h: str) -> tuple[bool, bool]` (ok, needs_rehash), `is_common_password(p) -> bool`, `validate_password_strength(p) -> None` (lanza `ApiError(422, "La contraseña debe tener al menos 10 caracteres.", "password_too_short")` / `password_too_common`).
- `AccessClaims(sub: str, role: str, jti: str, exp: int)`; `create_access_token(user_id: UUID, role: str) -> str`; `decode_access_token(token: str) -> AccessClaims` (lanza `ApiError(401, "Sesión expirada.", "token_expired")` o `token_invalid`); `new_opaque_token() -> tuple[str, str]` (raw, sha256 hex); `hash_token(raw) -> str`.
- `set_auth_cookies(resp, access, refresh)`, `clear_auth_cookies(resp)`. Nombres: `access_token` (Path=/), `refresh_token` (Path=/api/auth).
- `CsrfMiddleware` (Starlette `BaseHTTPMiddleware`): para métodos no seguros bajo `/api`: exige `X-Requested-With: fetch` y, si viene `Origin`, que esté en `allowed_origins`; 403 `{"detail":"Solicitud rechazada.","code":"csrf"}`.
- `async def rate_limit(db, key: str, limit: int, window_seconds: int) -> None` (lanza `ApiError(429, "Demasiados intentos. Probá más tarde.", "rate_limited")` con header `Retry-After`).
- `class Mailer(Protocol): async def send(to: str, subject: str, text: str) -> None`; `ConsoleMailer(dir=".dev-mail")`, `SmtpMailer(...)`; `get_mailer() -> Mailer`; `render("verify", url=...) -> str`.

- [ ] **Paso 1: Tests (fallan primero)**

```python
# tests/auth/test_passwords.py
import pytest
from app.auth.passwords import hash_password, is_common_password, validate_password_strength, verify_password
from app.errors import ApiError

def test_hash_and_verify_argon2id() -> None:
    h = hash_password("Correcto-Caballo-2026")
    assert h.startswith("$argon2id$")
    assert verify_password("Correcto-Caballo-2026", h) == (True, False)
    assert verify_password("otra", h)[0] is False

def test_common_password_rejected() -> None:
    assert is_common_password("password123")
    with pytest.raises(ApiError) as e: validate_password_strength("password123")
    assert e.value.detail["code"] == "password_too_common"
    with pytest.raises(ApiError): validate_password_strength("corta1")
```

```python
# tests/auth/test_tokens.py
import uuid, time
import pytest
from app.auth.tokens import create_access_token, decode_access_token, new_opaque_token, hash_token
from app.errors import ApiError

def test_access_token_roundtrip() -> None:
    uid = uuid.uuid4()
    claims = decode_access_token(create_access_token(uid, "admin"))
    assert claims.sub == str(uid) and claims.role == "admin" and claims.exp > time.time()

def test_tampered_token_rejected() -> None:
    t = create_access_token(uuid.uuid4(), "user")
    with pytest.raises(ApiError) as e: decode_access_token(t[:-3] + "abc")
    assert e.value.detail["code"] == "token_invalid"

def test_opaque_token_hash() -> None:
    raw, h = new_opaque_token()
    assert len(raw) >= 43 and hash_token(raw) == h and len(h) == 64
```

```python
# tests/auth/test_csrf.py
from httpx import AsyncClient

async def test_mutation_without_header_is_403(client: AsyncClient) -> None:
    r = await client.post("/api/auth/logout")
    assert r.status_code == 403 and r.json()["code"] == "csrf"

async def test_mutation_with_bad_origin_is_403(client: AsyncClient) -> None:
    r = await client.post("/api/auth/logout", headers={"X-Requested-With": "fetch", "Origin": "https://evil.example"})
    assert r.status_code == 403

async def test_get_is_not_blocked(client: AsyncClient) -> None:
    assert (await client.get("/api/health")).status_code == 200
```

```python
# tests/auth/test_ratelimit.py
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.ratelimit import rate_limit
from app.errors import ApiError

async def test_rate_limit_raises_after_limit(db: AsyncSession) -> None:
    for _ in range(2): await rate_limit(db, "t:x", 2, 60)
    with pytest.raises(ApiError) as e: await rate_limit(db, "t:x", 2, 60)
    assert e.value.status_code == 429 and e.value.headers["Retry-After"] == "60"
```

```python
# tests/auth/test_mail.py
from pathlib import Path
from app.auth.mail import ConsoleMailer, render

async def test_console_mailer_writes_eml(tmp_path: Path) -> None:
    m = ConsoleMailer(tmp_path)
    await m.send("ana@f1pp.test", "Verificá tu email", render("verify", url="http://x/verificar?token=abc", nickname="ana"))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1 and "http://x/verificar?token=abc" in files[0].read_text(encoding="utf-8")
```

- [ ] **Paso 2: Implementación**

`app/auth/passwords.py`:

```python
from functools import lru_cache
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

from app.errors import ApiError

_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
MIN_LEN = 10


@lru_cache
def _common() -> frozenset[str]:
    return frozenset(l.strip().lower() for l in (Path(__file__).parent / "common_passwords.txt").read_text(encoding="utf-8").splitlines() if l.strip())


def is_common_password(p: str) -> bool:
    return p.lower() in _common()


def validate_password_strength(p: str) -> None:
    if len(p) < MIN_LEN:
        raise ApiError(422, f"La contraseña debe tener al menos {MIN_LEN} caracteres.", "password_too_short")
    if len(p) > 128:
        raise ApiError(422, "La contraseña es demasiado larga.", "password_too_long")
    if is_common_password(p):
        raise ApiError(422, "Esa contraseña es demasiado común. Elegí otra.", "password_too_common")


def hash_password(p: str) -> str:
    return _ph.hash(p)


def verify_password(p: str, h: str) -> tuple[bool, bool]:
    try:
        _ph.verify(h, p)
    except (VerifyMismatchError, InvalidHashError):
        return False, False
    return True, _ph.check_needs_rehash(h)


DUMMY_HASH = hash_password("dummy-password-for-timing-0000")
```

`app/auth/tokens.py`:

```python
import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass

import jwt

from app.config import settings
from app.errors import ApiError


@dataclass(frozen=True)
class AccessClaims:
    sub: str
    role: str
    jti: str
    exp: int


def create_access_token(user_id: uuid.UUID, role: str, *, minutes: int | None = None) -> str:
    now = int(time.time())
    payload = {"sub": str(user_id), "role": role, "jti": uuid.uuid4().hex, "iat": now,
               "exp": now + 60 * (minutes or settings.access_token_minutes), "iss": "f1pp"}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> AccessClaims:
    try:
        p = jwt.decode(token, settings.secret_key, algorithms=["HS256"], issuer="f1pp", options={"require": ["exp", "sub", "jti"]})
    except jwt.ExpiredSignatureError as e:
        raise ApiError(401, "Sesión expirada.", "token_expired") from e
    except jwt.PyJWTError as e:
        raise ApiError(401, "Sesión inválida.", "token_invalid") from e
    return AccessClaims(sub=p["sub"], role=p.get("role", "user"), jti=p["jti"], exp=p["exp"])


def new_opaque_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
```

`app/auth/cookies.py`:

```python
from fastapi import Response

from app.config import settings

ACCESS, REFRESH = "access_token", "refresh_token"


def set_auth_cookies(resp: Response, access: str, refresh: str) -> None:
    common = {"httponly": True, "secure": settings.cookie_secure, "samesite": "lax"}
    resp.set_cookie(ACCESS, access, max_age=settings.access_token_minutes * 60, path="/", **common)
    resp.set_cookie(REFRESH, refresh, max_age=settings.refresh_token_days * 86400, path="/api/auth", **common)


def clear_auth_cookies(resp: Response) -> None:
    resp.delete_cookie(ACCESS, path="/")
    resp.delete_cookie(REFRESH, path="/api/auth")
```

`app/auth/csrf.py`:

```python
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings

SAFE = {"GET", "HEAD", "OPTIONS"}


class CsrfMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in SAFE and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if request.headers.get("x-requested-with") != "fetch" or (origin and origin not in settings.allowed_origins):
                return JSONResponse({"detail": "Solicitud rechazada.", "code": "csrf"}, status_code=403)
        return await call_next(request)
```

`app/auth/ratelimit.py`:

```python
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError


async def rate_limit(db: AsyncSession, key: str, limit: int, window_seconds: int) -> None:
    ok = await db.scalar(text("SELECT bump_rate_limit(:k, :l, :w)"), {"k": key, "l": limit, "w": window_seconds})
    await db.commit()  # el contador debe persistir aunque la request falle después
    if not ok:
        err = ApiError(429, "Demasiados intentos. Probá más tarde.", "rate_limited")
        err.headers = {"Retry-After": str(window_seconds)}
        raise err
```

`app/auth/mail.py`:

```python
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

import aiosmtplib
import structlog

from app.config import settings

log = structlog.get_logger()
TEMPLATES = Path(__file__).parent / "templates"


def render(name: str, **vars: str) -> str:
    body = (TEMPLATES / f"{name}.txt").read_text(encoding="utf-8")
    for k, v in vars.items():
        body = body.replace("{" + k + "}", v)
    return body


class Mailer(Protocol):
    async def send(self, to: str, subject: str, text: str) -> None: ...


class ConsoleMailer:
    def __init__(self, directory: Path | str = ".dev-mail") -> None:
        self.dir = Path(directory); self.dir.mkdir(parents=True, exist_ok=True)

    async def send(self, to: str, subject: str, text: str) -> None:
        msg = EmailMessage(); msg["From"], msg["To"], msg["Subject"] = settings.mail_from, to, subject; msg.set_content(text)
        path = self.dir / f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}-{to.replace('@', '_at_')}.eml"
        path.write_text(msg.as_string(), encoding="utf-8")
        log.info("mail.console", to=to[:1] + "***", subject=subject, path=str(path))


class SmtpMailer:
    async def send(self, to: str, subject: str, text: str) -> None:
        msg = EmailMessage(); msg["From"], msg["To"], msg["Subject"] = settings.mail_from, to, subject; msg.set_content(text)
        await aiosmtplib.send(msg, hostname=settings.smtp_host, port=settings.smtp_port, username=settings.smtp_user,
                              password=settings.smtp_password, start_tls=True, timeout=20)


def get_mailer() -> Mailer:
    return SmtpMailer() if settings.mail_backend == "smtp" else ConsoleMailer()
```

`templates/verify.txt`:

```
Hola {nickname},

Gracias por registrarte en F1 Predictor Pro. Para activar tu cuenta, abrí este enlace (vence en 24 horas):

{url}

Si no creaste esta cuenta, ignorá este mensaje.
```

`templates/reset.txt`: equivalente con "Pediste restablecer tu contraseña… (vence en 1 hora)".

- [ ] **Paso 3: Registrar middleware, correr tests, commit**

En `create_app()`: `app.add_middleware(CsrfMiddleware)`. Run: `uv run pytest tests/auth -v` → PASS (los de CSRF necesitan el router de logout; hasta T3 se puede usar `POST /api/health` como objetivo temporal del test y luego ajustarlo). Commit: `feat(auth): argon2id, JWT de acceso, tokens opacos, cookies, CSRF, rate limit y mailer`.

---

### Tarea 3: Endpoints de auth y dependencias de usuario

**Archivos:**
- Crear: `app/auth/deps.py`, `app/auth/service.py`, `app/auth/router.py`, `app/schemas/auth.py`
- Modificar: `app/main.py` (incluir router con prefix `/api/auth`)
- Test: `tests/auth/test_auth_flow.py`, `tests/auth/test_auth_enumeration.py`

**Interfaces:**
- Schemas: `RegisterIn(email: EmailStr, password: str, nickname: str)`, `LoginIn(email, password)`, `ForgotIn(email)`, `ResetIn(token: str, password: str)`, `VerifyIn(token: str)`, `ResendIn(email)`, `MeOut(id, email, role, is_verified, profile: ProfileOut)`, `ProfileOut(nickname, avatar_url, country, timezone)`, `OkOut(ok: bool = True)`.
- Deps: `get_current_user(request, db) -> User` (lee cookie, 401 `unauthorized`; 403 `email_not_verified` si no verificado y `require_verified=True`), `get_optional_user`, `require_admin(user) -> User` (403 `forbidden`).
- Endpoints (todos bajo `/api/auth`): `POST /register` (201, envía verificación; respuesta genérica), `POST /verify`, `POST /resend-verification`, `POST /login` (200 + cookies; 401 `invalid_credentials`; 403 `email_not_verified`), `POST /refresh` (rota; 401 y limpia cookies si inválido/reusado), `POST /logout` (revoca familia; limpia cookies), `POST /forgot`, `POST /reset`.
- Service: `register_user(db, mailer, data, ip) -> None`, `login(db, email, password, ip, ua) -> tuple[User, str, str]`, `rotate_refresh(db, raw, ip, ua) -> tuple[User, str, str]`, `revoke_family(db, raw)`, `issue_email_token(db, user, purpose) -> str`, `consume_email_token(db, raw, purpose) -> User`.

- [ ] **Paso 1: Tests (fallan primero)**

```python
# tests/auth/test_auth_flow.py
import re
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.users import RefreshToken, User

H = {"X-Requested-With": "fetch"}


def _last_link(maildir: Path, kind: str) -> str:
    files = sorted(maildir.glob("*.eml"))
    m = re.search(rf"(http://\S+/{kind}\?token=\S+)", files[-1].read_text(encoding="utf-8"))
    assert m
    return m.group(1).split("token=")[1]


async def register_and_verify(client: AsyncClient, maildir: Path, email: str = "nueva@f1pp.test", nick: str = "nueva") -> None:
    r = await client.post("/api/auth/register", json={"email": email, "password": "Clave-Segura-2026", "nickname": nick}, headers=H)
    assert r.status_code == 201
    token = _last_link(maildir, "verificar")
    assert (await client.post("/api/auth/verify", json={"token": token}, headers=H)).status_code == 200


async def test_register_verify_login_me(client: AsyncClient, maildir: Path) -> None:
    await register_and_verify(client, maildir)
    r = await client.post("/api/auth/login", json={"email": "Nueva@f1pp.test", "password": "Clave-Segura-2026"}, headers=H)
    assert r.status_code == 200 and "access_token" in r.cookies and "refresh_token" in r.cookies
    me = await client.get("/api/me")
    assert me.status_code == 200 and me.json()["profile"]["nickname"] == "nueva" and me.json()["is_verified"]


async def test_login_blocked_until_verified(client: AsyncClient, maildir: Path) -> None:
    await client.post("/api/auth/register", json={"email": "sinver@f1pp.test", "password": "Clave-Segura-2026", "nickname": "sinver"}, headers=H)
    r = await client.post("/api/auth/login", json={"email": "sinver@f1pp.test", "password": "Clave-Segura-2026"}, headers=H)
    assert r.status_code == 403 and r.json()["code"] == "email_not_verified"


async def test_refresh_rotates_and_reuse_revokes_family(client: AsyncClient, maildir: Path, db: AsyncSession) -> None:
    await register_and_verify(client, maildir)
    await client.post("/api/auth/login", json={"email": "nueva@f1pp.test", "password": "Clave-Segura-2026"}, headers=H)
    old_refresh = client.cookies["refresh_token"]
    r1 = await client.post("/api/auth/refresh", headers=H)
    assert r1.status_code == 200 and client.cookies["refresh_token"] != old_refresh
    client.cookies.set("refresh_token", old_refresh, path="/api/auth")    # atacante reusa el viejo
    r2 = await client.post("/api/auth/refresh", headers=H)
    assert r2.status_code == 401
    toks = (await db.execute(select(RefreshToken))).scalars().all()
    assert all(t.revoked_at is not None for t in toks)


async def test_login_rate_limited_per_email(client: AsyncClient, maildir: Path) -> None:
    await register_and_verify(client, maildir)
    for _ in range(5):
        await client.post("/api/auth/login", json={"email": "nueva@f1pp.test", "password": "mala-mala-mala"}, headers=H)
    r = await client.post("/api/auth/login", json={"email": "nueva@f1pp.test", "password": "Clave-Segura-2026"}, headers=H)
    assert r.status_code == 429


async def test_forgot_reset_flow(client: AsyncClient, maildir: Path) -> None:
    await register_and_verify(client, maildir)
    assert (await client.post("/api/auth/forgot", json={"email": "nueva@f1pp.test"}, headers=H)).status_code == 200
    token = _last_link(maildir, "restablecer")
    assert (await client.post("/api/auth/reset", json={"token": token, "password": "Otra-Clave-2026"}, headers=H)).status_code == 200
    assert (await client.post("/api/auth/reset", json={"token": token, "password": "Otra-Clave-2027"}, headers=H)).status_code == 400
    assert (await client.post("/api/auth/login", json={"email": "nueva@f1pp.test", "password": "Otra-Clave-2026"}, headers=H)).status_code == 200
```

```python
# tests/auth/test_auth_enumeration.py
from httpx import AsyncClient
H = {"X-Requested-With": "fetch"}

async def test_forgot_same_response_for_unknown_email(client: AsyncClient) -> None:
    r = await client.post("/api/auth/forgot", json={"email": "nadie@f1pp.test"}, headers=H)
    assert r.status_code == 200 and r.json() == {"ok": True}

async def test_register_duplicate_email_same_response(client: AsyncClient, maildir) -> None:
    body = {"email": "dup@f1pp.test", "password": "Clave-Segura-2026", "nickname": "dup1"}
    assert (await client.post("/api/auth/register", json=body, headers=H)).status_code == 201
    body["nickname"] = "dup2"
    assert (await client.post("/api/auth/register", json=body, headers=H)).status_code == 201   # no revela que existe; manda mail "ya tenés cuenta"

async def test_register_duplicate_nickname_is_422(client: AsyncClient, maildir) -> None:
    body = {"email": "n1@f1pp.test", "password": "Clave-Segura-2026", "nickname": "mismo"}
    await client.post("/api/auth/register", json=body, headers=H)
    r = await client.post("/api/auth/register", json={**body, "email": "n2@f1pp.test"}, headers=H)
    assert r.status_code == 422 and r.json()["code"] == "nickname_taken"
```

Fixture `maildir` en `conftest.py`: `tmp_path` + override de `get_mailer` en `app.dependency_overrides` para devolver `ConsoleMailer(tmp_path)`.

- [ ] **Paso 2: Implementación**

`app/auth/deps.py`:

```python
import uuid

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.cookies import ACCESS
from app.auth.tokens import decode_access_token
from app.db import get_db
from app.errors import ApiError
from app.models.users import User


async def _load(request: Request, db: AsyncSession) -> User | None:
    raw = request.cookies.get(ACCESS)
    if not raw:
        return None
    claims = decode_access_token(raw)
    user = await db.get(User, uuid.UUID(claims.sub), options=[selectinload(User.profile)])
    if user is None or not user.is_active:
        raise ApiError(401, "No autorizado.", "unauthorized")
    return user


async def get_optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    return await _load(request, db)


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    user = await _load(request, db)
    if user is None:
        raise ApiError(401, "No autorizado.", "unauthorized")
    return user


async def get_verified_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_verified:
        raise ApiError(403, "Tenés que verificar tu email.", "email_not_verified")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise ApiError(403, "No tenés permisos para esta acción.", "forbidden")
    return user
```

`app/auth/service.py` (núcleo):

```python
import re
import uuid
from datetime import UTC, datetime, timedelta

from email_validator import validate_email, EmailNotValidError
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.mail import Mailer, render
from app.auth.passwords import DUMMY_HASH, hash_password, validate_password_strength, verify_password
from app.auth.ratelimit import rate_limit
from app.auth.tokens import create_access_token, hash_token, new_opaque_token
from app.config import settings
from app.errors import ApiError
from app.models.users import EmailToken, Profile, RefreshToken, User

NICK_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")


def normalize_email(email: str) -> str:
    try:
        return validate_email(email, check_deliverability=False).normalized.lower()
    except EmailNotValidError as e:
        raise ApiError(422, "El email no es válido.", "email_invalid") from e


async def issue_email_token(db: AsyncSession, user: User, purpose: str) -> str:
    raw, h = new_opaque_token()
    ttl = timedelta(hours=24) if purpose == "verify" else timedelta(hours=1)
    db.add(EmailToken(user_id=user.id, purpose=purpose, token_hash=h, expires_at=datetime.now(UTC) + ttl))
    await db.flush()
    return raw


async def consume_email_token(db: AsyncSession, raw: str, purpose: str) -> User:
    tok = await db.scalar(select(EmailToken).where(EmailToken.token_hash == hash_token(raw), EmailToken.purpose == purpose))
    if tok is None or tok.used_at is not None or tok.expires_at < datetime.now(UTC):
        raise ApiError(400, "El enlace no es válido o venció.", "token_invalid")
    tok.used_at = datetime.now(UTC)
    user = await db.get(User, tok.user_id, options=[selectinload(User.profile)])
    assert user is not None
    return user


async def register_user(db: AsyncSession, mailer: Mailer, email: str, password: str, nickname: str, ip: str) -> None:
    await rate_limit(db, f"register:ip:{ip}", 5, 3600)
    email = normalize_email(email)
    validate_password_strength(password)
    if not NICK_RE.match(nickname):
        raise ApiError(422, "El nick debe tener entre 3 y 20 caracteres: letras, números o guion bajo.", "nickname_invalid")
    if await db.scalar(select(Profile.user_id).where(func.lower(Profile.nickname) == nickname.lower())):
        raise ApiError(422, "Ese nick ya está en uso.", "nickname_taken")
    existing = await db.scalar(select(User).where(func.lower(User.email) == email))
    if existing:
        await mailer.send(email, "Ya tenés una cuenta en F1 Predictor Pro", render("already_registered", url=f"{settings.public_base_url}/recuperar"))
        return
    user = User(email=email, password_hash=hash_password(password))
    db.add(user); await db.flush()
    db.add(Profile(user_id=user.id, nickname=nickname))
    raw = await issue_email_token(db, user, "verify")
    await mailer.send(email, "Verificá tu email", render("verify", nickname=nickname, url=f"{settings.public_base_url}/verificar?token={raw}"))
    await db.commit()


async def _issue_session(db: AsyncSession, user: User, ip: str, ua: str, family: uuid.UUID | None = None) -> tuple[str, str]:
    raw, h = new_opaque_token()
    db.add(RefreshToken(user_id=user.id, token_hash=h, family_id=family or uuid.uuid4(),
                        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days), user_agent=ua[:256], ip=ip))
    await db.flush()
    return create_access_token(user.id, user.role), raw


async def login(db: AsyncSession, email: str, password: str, ip: str, ua: str) -> tuple[User, str, str]:
    await rate_limit(db, f"login:ip:{ip}", 20, 900)
    email = normalize_email(email)
    await rate_limit(db, f"login:email:{email}", 5, 900)
    user = await db.scalar(select(User).where(func.lower(User.email) == email).options(selectinload(User.profile)))
    ok, rehash = verify_password(password, user.password_hash if user else DUMMY_HASH)
    if user is None or not ok or not user.is_active:
        raise ApiError(401, "Email o contraseña incorrectos.", "invalid_credentials")
    if not user.is_verified:
        raise ApiError(403, "Tenés que verificar tu email antes de ingresar.", "email_not_verified")
    if rehash:
        user.password_hash = hash_password(password)
    user.last_login_at = datetime.now(UTC)
    access, refresh = await _issue_session(db, user, ip, ua)
    await db.commit()
    return user, access, refresh


async def rotate_refresh(db: AsyncSession, raw: str, ip: str, ua: str) -> tuple[User, str, str]:
    tok = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    if tok is None:
        raise ApiError(401, "Sesión inválida.", "refresh_invalid")
    now = datetime.now(UTC)
    if tok.revoked_at is not None or tok.expires_at < now:
        await db.execute(update(RefreshToken).where(RefreshToken.family_id == tok.family_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
        await db.commit()
        raise ApiError(401, "Sesión inválida. Ingresá de nuevo.", "refresh_reused")
    user = await db.get(User, tok.user_id, options=[selectinload(User.profile)])
    if user is None or not user.is_active:
        raise ApiError(401, "No autorizado.", "unauthorized")
    access, new_raw = await _issue_session(db, user, ip, ua, family=tok.family_id)
    tok.revoked_at = now
    tok.replaced_by_id = (await db.scalar(select(RefreshToken.id).where(RefreshToken.token_hash == hash_token(new_raw))))
    await db.commit()
    return user, access, new_raw


async def revoke_family(db: AsyncSession, raw: str | None) -> None:
    if not raw:
        return
    tok = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    if tok:
        await db.execute(update(RefreshToken).where(RefreshToken.family_id == tok.family_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
        await db.commit()


async def forgot(db: AsyncSession, mailer: Mailer, email: str, ip: str) -> None:
    await rate_limit(db, f"forgot:ip:{ip}", 10, 3600)
    email = normalize_email(email)
    await rate_limit(db, f"forgot:email:{email}", 3, 3600)
    user = await db.scalar(select(User).where(func.lower(User.email) == email).options(selectinload(User.profile)))
    if user:
        raw = await issue_email_token(db, user, "reset")
        await mailer.send(email, "Restablecer contraseña", render("reset", nickname=user.profile.nickname, url=f"{settings.public_base_url}/restablecer?token={raw}"))
        await db.commit()


async def reset(db: AsyncSession, raw: str, password: str) -> None:
    validate_password_strength(password)
    user = await consume_email_token(db, raw, "reset")
    user.password_hash = hash_password(password)
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    await db.commit()
```

`app/auth/router.py`: endpoints finos que llaman al servicio, con `request.client.host` (o `X-Real-IP` detrás de nginx: usar `request.headers.get("x-real-ip", request.client.host)` solo si `settings.env == "prod"`), `request.headers.get("user-agent", "")`, y `set_auth_cookies`/`clear_auth_cookies`. `POST /register` devuelve `201 {"ok": true}` **siempre** (salvo 422 de validación/nick). `POST /verify` marca `email_verified_at` y devuelve `{"ok": true}`. `POST /resend-verification` rate-limited 3/h por email, sin revelar existencia. `GET /api/me` en `app/routers/me.py` (T4).

- [ ] **Paso 3: Tests y commit**

Run: `uv run pytest tests/auth -v` → PASS. Ajustar `tests/auth/test_csrf.py` para apuntar a `/api/auth/logout`. Commit: `feat(auth): registro con verificación, login, refresh rotativo con detección de reuso, logout, forgot/reset`.

---

### Tarea 4: `/api/me`: perfil y borrado de cuenta

**Archivos:**
- Crear: `app/routers/me.py`, `app/schemas/me.py`
- Test: `tests/test_me.py`

**Interfaces:**
- `GET /api/me -> MeOut`; `PATCH /api/me/profile {nickname?, country?, timezone?, avatar_url?} -> MeOut` (nick único, `avatar_url` solo `https://` y ≤ 512 chars); `PUT /api/me/password {current_password, new_password}` (revoca otras sesiones); `DELETE /api/me {password}` → 204, borra usuario (cascada) y transfiere ligas propias al miembro más antiguo o las borra si no hay otro; limpia cookies.

- [ ] **Paso 1: Tests (fallan primero)**

```python
from httpx import AsyncClient
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.users import User
from tests.auth.test_auth_flow import register_and_verify, H

async def login(client, email="nueva@f1pp.test", pw="Clave-Segura-2026"):
    assert (await client.post("/api/auth/login", json={"email": email, "password": pw}, headers=H)).status_code == 200

async def test_patch_profile_nick_conflict(client: AsyncClient, maildir) -> None:
    await register_and_verify(client, maildir, "a@f1pp.test", "nick_a"); await register_and_verify(client, maildir, "b@f1pp.test", "nick_b")
    await login(client, "b@f1pp.test")
    r = await client.patch("/api/me/profile", json={"nickname": "NICK_A"}, headers=H)
    assert r.status_code == 422 and r.json()["code"] == "nickname_taken"
    assert (await client.patch("/api/me/profile", json={"nickname": "nick_b2", "country": "AR"}, headers=H)).json()["profile"]["nickname"] == "nick_b2"

async def test_delete_account_requires_password_and_cascades(client: AsyncClient, maildir, db: AsyncSession) -> None:
    await register_and_verify(client, maildir); await login(client)
    assert (await client.request("DELETE", "/api/me", json={"password": "mala-mala-mala"}, headers=H)).status_code == 401
    assert (await client.request("DELETE", "/api/me", json={"password": "Clave-Segura-2026"}, headers=H)).status_code == 204
    assert await db.scalar(select(func.count()).select_from(User).where(User.email == "nueva@f1pp.test")) == 0
    assert (await client.get("/api/me")).status_code == 401
```

- [ ] **Paso 2: Implementar y commit**

Implementación directa con `get_current_user`; el `DELETE` usa `verify_password` y, antes de `db.delete(user)`, para cada liga con `owner_id == user.id`: nuevo owner = miembro más antiguo distinto del usuario, si no hay → `db.delete(league)`. Commit: `feat(api): perfil, cambio de contraseña y borrado de cuenta`.

---

### Tarea 5: Predicciones con cierre en el servidor

**Archivos:**
- Crear: `app/services/predictions.py`, `app/routers/predictions.py`, `app/schemas/predictions.py`
- Test: `tests/test_predictions.py`

**Interfaces:**
- `lock_times(event: Event) -> LockTimes(main: datetime | None, sprint: datetime | None)` (main = `starts_at` de Q − offset; sprint = `starts_at` de SQ − offset; `None` si la sesión no tiene hora → se considera **cerrado**).
- `PredictionIn(quali_top3: list[int|None] (len 3), sprint_top3: list[int|None] | None (len 3), race_top10: list[int|None] (len 10), fastest_lap_driver_id: int|None, dotd_driver_id: int|None)` con validadores: sin duplicados por lista, ids ∈ `season_entries` del año del evento.
- `PredictionOut(event_id, quali_top3, sprint_top3, race_top10, fastest_lap_driver_id, dotd_driver_id, locks: {main: datetime|None, sprint: datetime|None, main_locked: bool, sprint_locked: bool}, updated_at)`.
- `GET /api/predictions/{event_id}` (vacía con locks si no existe), `PUT /api/predictions/{event_id}` (409 `predictions_locked` si cambia un grupo cerrado; permite guardar el grupo abierto), `GET /api/predictions/history?year=` (lista con `score: {points, detail}` de `score_entries`), `GET /api/predictions/options/{event_id}` (pilotos de la temporada para el formulario: `DriverOut` + `TeamOut`).

- [ ] **Paso 1: Tests (fallan primero)**

```python
from datetime import UTC, datetime, timedelta
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.reference import Event, Session
from tests.auth.test_auth_flow import register_and_verify, H
from tests.test_me import login
from tests.test_jolpica_sync import make_client
from app.worker.jobs.jolpica_sync import sync_season


async def _event_and_drivers(client, db):
    await sync_season(db, make_client(), 2025)
    ev = (await db.execute(select(Event).where(Event.season_year == 2025, Event.round == 1))).scalar_one()
    await db.execute(update(Session).where(Session.event_id == ev.id).values(starts_at=datetime.now(UTC) + timedelta(days=2)))
    opts = (await client.get(f"/api/predictions/options/{ev.id}")).json()
    return ev, [d["id"] for d in opts["drivers"]]


async def test_put_and_get_prediction(client: AsyncClient, maildir, db: AsyncSession) -> None:
    await register_and_verify(client, maildir); await login(client)
    ev, ids = await _event_and_drivers(client, db)
    body = {"quali_top3": ids[:3], "sprint_top3": None, "race_top10": ids[:10], "fastest_lap_driver_id": ids[0], "dotd_driver_id": ids[1]}
    r = await client.put(f"/api/predictions/{ev.id}", json=body, headers=H)
    assert r.status_code == 200 and r.json()["race_top10"] == ids[:10] and r.json()["locks"]["main_locked"] is False
    assert (await client.get(f"/api/predictions/{ev.id}")).json()["fastest_lap_driver_id"] == ids[0]


async def test_duplicates_rejected(client: AsyncClient, maildir, db: AsyncSession) -> None:
    await register_and_verify(client, maildir); await login(client)
    ev, ids = await _event_and_drivers(client, db)
    r = await client.put(f"/api/predictions/{ev.id}", json={"quali_top3": [ids[0], ids[0], None], "race_top10": [None]*10, "fastest_lap_driver_id": None, "dotd_driver_id": None}, headers=H)
    assert r.status_code == 422 and r.json()["code"] == "duplicate_driver"


async def test_put_prediction_at_exact_lock_time_is_rejected(client: AsyncClient, maildir, db: AsyncSession) -> None:
    await register_and_verify(client, maildir); await login(client)
    ev, ids = await _event_and_drivers(client, db)
    await db.execute(update(Session).where(Session.event_id == ev.id, Session.type == "Q").values(starts_at=datetime.now(UTC)))
    r = await client.put(f"/api/predictions/{ev.id}", json={"quali_top3": ids[:3], "race_top10": [None]*10, "fastest_lap_driver_id": None, "dotd_driver_id": None}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == "predictions_locked"


async def test_sprint_group_stays_open_when_main_is_locked_only_if_sq_is_later(client: AsyncClient, maildir, db: AsyncSession) -> None:
    await register_and_verify(client, maildir); await login(client)
    await sync_season(db, make_client(), 2025)
    ev = (await db.execute(select(Event).where(Event.season_year == 2025, Event.is_sprint.is_(True)).order_by(Event.round))).scalars().first()
    assert ev is not None
    await db.execute(update(Session).where(Session.event_id == ev.id, Session.type == "SQ").values(starts_at=datetime.now(UTC) - timedelta(hours=1)))
    await db.execute(update(Session).where(Session.event_id == ev.id, Session.type == "Q").values(starts_at=datetime.now(UTC) + timedelta(hours=5)))
    opts = (await client.get(f"/api/predictions/options/{ev.id}")).json(); ids = [d["id"] for d in opts["drivers"]]
    r = await client.put(f"/api/predictions/{ev.id}", json={"quali_top3": ids[:3], "sprint_top3": ids[:3], "race_top10": [None]*10, "fastest_lap_driver_id": None, "dotd_driver_id": None}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == "predictions_locked"           # sprint cerrado
    r = await client.put(f"/api/predictions/{ev.id}", json={"quali_top3": ids[:3], "sprint_top3": None, "race_top10": [None]*10, "fastest_lap_driver_id": None, "dotd_driver_id": None}, headers=H)
    assert r.status_code == 200                                                        # grupo principal abierto
```

- [ ] **Paso 2: Implementación**

`app/services/predictions.py`:

```python
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.errors import ApiError
from app.models.game import Prediction
from app.models.reference import Event, SeasonEntry


@dataclass(frozen=True)
class LockTimes:
    main: datetime | None
    sprint: datetime | None


def lock_times(event: Event) -> LockTimes:
    by_type = {s.type: s.starts_at for s in event.sessions}
    off = timedelta(minutes=settings.prediction_lock_offset_minutes)
    main = (by_type.get("Q") - off) if by_type.get("Q") else None
    sprint = (by_type.get("SQ") - off) if event.is_sprint and by_type.get("SQ") else None
    return LockTimes(main=main, sprint=sprint)


def is_locked(lock: datetime | None, now: datetime) -> bool:
    return lock is None or now >= lock


def check_no_duplicates(*lists: list[int | None] | None) -> None:
    for lst in lists:
        vals = [v for v in (lst or []) if v is not None]
        if len(vals) != len(set(vals)):
            raise ApiError(422, "Hay pilotos repetidos en una misma lista.", "duplicate_driver")


async def valid_driver_ids(db: AsyncSession, year: int) -> set[int]:
    return set((await db.execute(select(SeasonEntry.driver_id).where(SeasonEntry.season_year == year))).scalars())


async def db_now(db: AsyncSession) -> datetime:
    return (await db.scalar(text("SELECT now()")))  # reloj de Postgres, mismo que usa el worker


async def upsert_prediction(db: AsyncSession, user_id, event: Event, data: dict) -> Prediction:
    check_no_duplicates(data["quali_top3"], data.get("sprint_top3"), data["race_top10"])
    allowed = await valid_driver_ids(db, event.season_year)
    used = {v for k in ("quali_top3", "sprint_top3", "race_top10") for v in (data.get(k) or []) if v is not None}
    used |= {v for v in (data.get("fastest_lap_driver_id"), data.get("dotd_driver_id")) if v is not None}
    if not used <= allowed:
        raise ApiError(422, "Hay pilotos que no corren esta temporada.", "driver_not_in_season")
    now = await db_now(db)
    locks = lock_times(event)
    existing = await db.scalar(select(Prediction).where(Prediction.user_id == user_id, Prediction.event_id == event.id).with_for_update())
    cur = existing or Prediction(user_id=user_id, event_id=event.id)
    main_changed = (cur.quali_top3 != data["quali_top3"] or cur.race_top10 != data["race_top10"]
                    or cur.fastest_lap_driver_id != data.get("fastest_lap_driver_id") or cur.dotd_driver_id != data.get("dotd_driver_id"))
    sprint_changed = event.is_sprint and (cur.sprint_top3 != data.get("sprint_top3"))
    if main_changed and is_locked(locks.main, now):
        raise ApiError(409, "Las predicciones de clasificación y carrera están cerradas.", "predictions_locked")
    if sprint_changed and is_locked(locks.sprint, now):
        raise ApiError(409, "Las predicciones del sprint están cerradas.", "predictions_locked")
    if main_changed:
        cur.quali_top3, cur.race_top10 = data["quali_top3"], data["race_top10"]
        cur.fastest_lap_driver_id, cur.dotd_driver_id = data.get("fastest_lap_driver_id"), data.get("dotd_driver_id")
    if sprint_changed:
        cur.sprint_top3 = data.get("sprint_top3")
    if existing is None:
        db.add(cur)
    await db.commit()
    await db.refresh(cur)
    return cur
```

Router: `GET`/`PUT` usan `get_verified_user`; cargan el evento con `selectinload(Event.sessions)`; `PredictionOut.locks` se calcula con `lock_times` y `db_now`. `options` devuelve pilotos (`SeasonEntry` del año) con su equipo actual.

- [ ] **Paso 3: Tests, tipos, commit**

Run: `uv run pytest tests/test_predictions.py -v` → PASS. Commit: `feat(api): predicciones con validación y cierre por sesión en el servidor`.

---

### Tarea 6: Reglas de puntuación puras `scoring/v2026.py`

**Archivos:**
- Crear: `app/scoring/__init__.py`, `app/scoring/base.py`, `app/scoring/v2026.py`
- Test: `tests/scoring/test_v2026.py`

**Interfaces:**
- `base.py`: `@dataclass(frozen=True) EventResults(pole: int|None, race_order: list[int], fastest_lap: int|None, dotd: int|None, sprint_order: list[int]|None, driver_team: dict[int,int])`; `@dataclass(frozen=True) PredictionData(quali_top3, sprint_top3, race_top10, fastest_lap, dotd)`; `@dataclass(frozen=True) FantasyData(driver_ids: list[int], team_ids: list[int])`; `@dataclass ScoreItem(rule: str, points: int, driver_id: int|None, label: str)`; `@dataclass Breakdown(points: int, items: list[ScoreItem])`; `Protocol Ruleset: score_prediction(pred, res, codes) -> Breakdown; score_fantasy(fantasy, res, codes) -> Breakdown; guess_points(wins_today_after: int, games_today_after: int) -> int`.
- `v2026.py`: constantes `RACE_POINTS = {1:25,2:18,3:15,4:12,5:10,6:8,7:6,8:4,9:2,10:1}`, `SPRINT_POINTS = {1:8,2:7,3:6,4:5,5:4,6:3,7:2,8:1}`, `RULES = {"pole":10, "race_podium_exact":25, "race_podium_wrong_pos":10, "race_top10_exact":5, "race_top10_wrong_pos":2, "fastest_lap":10, "dotd":8, "sprint_winner":15, "sprint_podium_exact":8, "perfect_race":100}`, `GUESS_WIN=10`, `GUESS_BONUS=20`, `RULESET = V2026()`.
- `get_ruleset(year) -> Ruleset` en `scoring/__init__.py` (2026 y posteriores → V2026).

- [ ] **Paso 1: Tests (fallan primero)**

```python
from app.scoring.base import EventResults, FantasyData, PredictionData
from app.scoring.v2026 import V2026

R = V2026()
CODES = {i: f"D{i:02d}" for i in range(1, 25)}
res = EventResults(pole=1, race_order=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], fastest_lap=2, dotd=3, sprint_order=[2, 1, 3, 4, 5, 6, 7, 8, 9],
                   driver_team={1: 100, 2: 100, 3: 101, 4: 101, 5: 102, 6: 102, 7: 103, 8: 103, 9: 104, 10: 104, 11: 105, 12: 105})


def test_exact_podium_and_top10() -> None:
    p = PredictionData(quali_top3=[1, 2, 3], sprint_top3=None, race_top10=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], fastest_lap=2, dotd=3)
    b = R.score_prediction(p, res, CODES)
    assert b.points == 10 + 25 * 3 + 5 * 7 + 10 + 8 + 100
    assert any(i.rule == "perfect_race" for i in b.items)
    assert any(i.label == "Pole D01 +10" for i in b.items)


def test_wrong_positions() -> None:
    p = PredictionData(quali_top3=[2, 1, 3], sprint_top3=None, race_top10=[2, 1, 11, 4, 12, 6, 7, 8, 9, 3], fastest_lap=1, dotd=None)
    b = R.score_prediction(p, res, CODES)
    # pole no (2≠1); podio: 2 y 1 en podio pos. incorrecta (10+10); 11 fuera del top10 (0); 4 exacto (5); 12 no (0); 6,7,8,9 exactos (20); 3 en top10 pos. incorrecta (2)
    assert b.points == 10 + 10 + 5 + 20 + 2


def test_sprint_rules_winner_not_double_counted() -> None:
    p = PredictionData(quali_top3=[None] * 3, sprint_top3=[2, 1, 3], race_top10=[None] * 10, fastest_lap=None, dotd=None)
    assert R.score_prediction(p, res, CODES).points == 15 + 8 + 8


def test_no_dotd_yet_means_no_dotd_and_no_perfect() -> None:
    res2 = EventResults(**{**res.__dict__, "dotd": None})
    p = PredictionData(quali_top3=[1, 2, 3], sprint_top3=None, race_top10=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], fastest_lap=2, dotd=3)
    assert R.score_prediction(p, res2, CODES).points == 10 + 75 + 35 + 10


def test_fantasy_points_without_fastest_lap_bonus_and_with_sprint() -> None:
    f = FantasyData(driver_ids=[1, 2, 11, 12], team_ids=[101, 105])
    b = R.score_fantasy(f, res, CODES)
    drivers = 25 + 18 + 0 + 0 + 7 + 8            # carrera: 1→25, 2→18; sprint: 1→P2 7, 2→P1 8
    teams = (15 + 12 + 6 + 5) + (0 + 0)          # 101: pilotos 3 y 4 → 15+12 carrera, 6+5 sprint; 105: 11 y 12 → 0
    assert b.points == drivers + teams


def test_guess_points() -> None:
    assert R.guess_points(wins_today_after=1, games_today_after=1) == 10
    assert R.guess_points(wins_today_after=3, games_today_after=3) == 30
    assert R.guess_points(wins_today_after=2, games_today_after=3) == 10
```

- [ ] **Paso 2: Implementación**

```python
from app.scoring.base import Breakdown, EventResults, FantasyData, PredictionData, ScoreItem

RACE_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}
SPRINT_POINTS = {1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1}
RULES = {"pole": 10, "race_podium_exact": 25, "race_podium_wrong_pos": 10, "race_top10_exact": 5, "race_top10_wrong_pos": 2,
         "fastest_lap": 10, "dotd": 8, "sprint_winner": 15, "sprint_podium_exact": 8, "perfect_race": 100}
GUESS_WIN, GUESS_BONUS, GUESS_GAMES_PER_DAY = 10, 20, 3


class V2026:
    version = "2026"

    def score_prediction(self, p: PredictionData, r: EventResults, codes: dict[int, str]) -> Breakdown:
        items: list[ScoreItem] = []
        c = lambda d: codes.get(d, str(d))  # noqa: E731
        if p.quali_top3 and p.quali_top3[0] is not None and p.quali_top3[0] == r.pole:
            items.append(ScoreItem("pole", RULES["pole"], r.pole, f"Pole {c(r.pole)} +{RULES['pole']}"))
        top10 = r.race_order[:10]
        for idx, d in enumerate(p.race_top10):
            if d is None:
                continue
            pos = idx + 1
            if idx < len(top10) and top10[idx] == d:
                rule = "race_podium_exact" if pos <= 3 else "race_top10_exact"
                items.append(ScoreItem(rule, RULES[rule], d, f"P{pos} exacto {c(d)} +{RULES[rule]}"))
            elif d in top10:
                actual = top10.index(d) + 1
                rule = "race_podium_wrong_pos" if (pos <= 3 and actual <= 3) else "race_top10_wrong_pos"
                items.append(ScoreItem(rule, RULES[rule], d, f"{c(d)} en P{actual} (predicho P{pos}) +{RULES[rule]}"))
        if p.fastest_lap is not None and p.fastest_lap == r.fastest_lap:
            items.append(ScoreItem("fastest_lap", RULES["fastest_lap"], r.fastest_lap, f"Vuelta rápida {c(r.fastest_lap)} +{RULES['fastest_lap']}"))
        if r.dotd is not None and p.dotd == r.dotd:
            items.append(ScoreItem("dotd", RULES["dotd"], r.dotd, f"Piloto del Día {c(r.dotd)} +{RULES['dotd']}"))
        if r.sprint_order and p.sprint_top3:
            for idx, d in enumerate(p.sprint_top3[:3]):
                if d is not None and idx < len(r.sprint_order) and r.sprint_order[idx] == d:
                    rule = "sprint_winner" if idx == 0 else "sprint_podium_exact"
                    items.append(ScoreItem(rule, RULES[rule], d, f"Sprint P{idx + 1} exacto {c(d)} +{RULES[rule]}"))
        perfect = (r.dotd is not None and len(top10) == 10 and p.race_top10 == top10 and p.fastest_lap == r.fastest_lap and p.dotd == r.dotd)
        if perfect:
            items.append(ScoreItem("perfect_race", RULES["perfect_race"], None, f"Predicción perfecta +{RULES['perfect_race']}"))
        return Breakdown(points=sum(i.points for i in items), items=items)

    def score_fantasy(self, f: FantasyData, r: EventResults, codes: dict[int, str]) -> Breakdown:
        items: list[ScoreItem] = []
        race_pos = {d: i + 1 for i, d in enumerate(r.race_order)}
        sprint_pos = {d: i + 1 for i, d in enumerate(r.sprint_order or [])}

        def driver_pts(d: int) -> tuple[int, int]:
            return RACE_POINTS.get(race_pos.get(d, 0), 0), SPRINT_POINTS.get(sprint_pos.get(d, 0), 0)

        for d in f.driver_ids:
            rp, sp = driver_pts(d)
            if rp: items.append(ScoreItem("fantasy_driver_race", rp, d, f"{codes.get(d, d)} carrera P{race_pos[d]} +{rp}"))
            if sp: items.append(ScoreItem("fantasy_driver_sprint", sp, d, f"{codes.get(d, d)} sprint P{sprint_pos[d]} +{sp}"))
        for t in f.team_ids:
            for d, team in r.driver_team.items():
                if team != t:
                    continue
                rp, sp = driver_pts(d)
                if rp: items.append(ScoreItem("fantasy_team_race", rp, d, f"Escudería: {codes.get(d, d)} carrera P{race_pos[d]} +{rp}"))
                if sp: items.append(ScoreItem("fantasy_team_sprint", sp, d, f"Escudería: {codes.get(d, d)} sprint P{sprint_pos[d]} +{sp}"))
        return Breakdown(points=sum(i.points for i in items), items=items)

    def guess_points(self, wins_today_after: int, games_today_after: int) -> int:
        pts = GUESS_WIN
        if games_today_after == GUESS_GAMES_PER_DAY and wins_today_after == GUESS_GAMES_PER_DAY:
            pts += GUESS_BONUS
        return pts
```

Run: `uv run pytest tests/scoring -v` → PASS. Commit: `feat(scoring): reglas v2026 puras con desglose explicable y tests`.

---

### Tarea 7: Fantasy: equipo, cambios y snapshots

**Archivos:**
- Crear: `app/services/fantasy.py`, `app/routers/fantasy.py`, `app/schemas/fantasy.py`, `app/worker/jobs/fantasy_snapshots.py`
- Modificar: `app/worker/scheduler.py` (job cada 5 min)
- Test: `tests/test_fantasy.py`

**Interfaces:**
- `FantasyTeamIn(driver_ids: list[int] (len 4, únicos), team_ids: list[int] (len 2, únicos))`, `FantasyTeamOut(season_year, driver_ids, team_ids, changes_remaining, drivers: list[DriverOut], teams: list[TeamOut], last_snapshot_event_id: int|None)`.
- `GET /api/fantasy/team?year=` (404 `no_team` si no existe), `PUT /api/fantasy/team` (crea sin consumir cambio; modifica consumiendo 1 si difiere; 409 `no_changes_left`).
- `async def take_snapshots(db, now) -> int`: para cada evento cuya `Q.starts_at - offset <= now` y sin snapshot para los equipos existentes del año → inserta `fantasy_snapshots`. Devuelve cantidad.
- `async def snapshot_for_user_event(db, user_id, event_id) -> FantasySnapshot | None` (usado por el runner).

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_create_then_change_consumes_one(client, maildir, db) -> None:
    await register_and_verify(client, maildir); await login(client)
    await sync_season(db, make_client(), 2025)
    opts = (await client.get("/api/fantasy/options?year=2025")).json()
    d, t = [x["id"] for x in opts["drivers"]], [x["id"] for x in opts["teams"]]
    r = await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[:4], "team_ids": t[:2]}, headers=H)
    assert r.status_code == 200 and r.json()["changes_remaining"] == 5
    r = await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[1:5], "team_ids": t[:2]}, headers=H)
    assert r.json()["changes_remaining"] == 4
    r = await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[1:5], "team_ids": t[:2]}, headers=H)
    assert r.json()["changes_remaining"] == 4      # sin cambios → no consume


async def test_no_changes_left(client, maildir, db) -> None:
    await register_and_verify(client, maildir); await login(client)
    await sync_season(db, make_client(), 2025)
    opts = (await client.get("/api/fantasy/options?year=2025")).json()
    d, t = [x["id"] for x in opts["drivers"]], [x["id"] for x in opts["teams"]]
    await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[:4], "team_ids": t[:2]}, headers=H)
    await db.execute(update(FantasyTeam).values(changes_remaining=0)); await db.commit()
    r = await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[1:5], "team_ids": t[:2]}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == "no_changes_left"
    r = await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[:4], "team_ids": t[:2]}, headers=H)
    assert r.status_code == 200          # guardar lo mismo no consume ni falla


async def test_snapshot_taken_at_q_lock_and_not_for_late_users(client, maildir, db) -> None:
    await sync_season(db, make_client(), 2025)
    ev = (await db.execute(select(Event).where(Event.season_year == 2025, Event.round == 1).options(selectinload(Event.sessions)))).scalar_one()
    await register_and_verify(client, maildir, "temprano@f1pp.test", "temprano"); await login(client, "temprano@f1pp.test")
    opts = (await client.get("/api/fantasy/options?year=2025")).json(); d, t = [x["id"] for x in opts["drivers"]], [x["id"] for x in opts["teams"]]
    await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[:4], "team_ids": t[:2]}, headers=H)
    q_start = next(s.starts_at for s in ev.sessions if s.type == "Q")
    assert await take_snapshots(db, now=q_start - timedelta(minutes=1)) == 0
    assert await take_snapshots(db, now=q_start) == 1
    assert await take_snapshots(db, now=q_start + timedelta(hours=1)) == 0      # idempotente
    await register_and_verify(client, maildir, "tarde@f1pp.test", "tarde"); await login(client, "tarde@f1pp.test")
    await client.put("/api/fantasy/team", json={"season_year": 2025, "driver_ids": d[:4], "team_ids": t[:2]}, headers=H)
    assert await take_snapshots(db, now=q_start + timedelta(hours=2)) == 0      # ya cerró: sin snapshot para "tarde"
```

- [ ] **Paso 2: Implementación**

`services/fantasy.py` valida contra `season_entries` (pilotos) y `teams` con entradas en el año; la lógica de cambios:

```python
async def put_team(db, user_id, year, driver_ids, team_ids) -> FantasyTeam:
    if len(set(driver_ids)) != 4 or len(set(team_ids)) != 2:
        raise ApiError(422, "Elegí 4 pilotos y 2 escuderías distintos.", "invalid_team")
    ...validación de ids...
    team = await db.scalar(select(FantasyTeam).where(FantasyTeam.user_id == user_id, FantasyTeam.season_year == year).with_for_update())
    if team is None:
        team = FantasyTeam(user_id=user_id, season_year=year, driver_ids=driver_ids, team_ids=team_ids, changes_remaining=settings.fantasy_changes_per_season)
        db.add(team)
    elif sorted(team.driver_ids) != sorted(driver_ids) or sorted(team.team_ids) != sorted(team_ids):
        if team.changes_remaining <= 0:
            raise ApiError(409, "No te quedan cambios esta temporada.", "no_changes_left")
        team.changes_remaining -= 1
        team.driver_ids, team.team_ids = driver_ids, team_ids
    await db.commit(); await db.refresh(team)
    return team
```

`take_snapshots`: eventos del año con `Q.starts_at - offset <= now` y `date_end >= now.date() - 30` (no re-escanear toda la temporada), `INSERT ... SELECT` desde `fantasy_teams` con `ON CONFLICT DO NOTHING`, **excluyendo** equipos cuyo `created_at > lock` (usuarios tardíos). Job `job_fantasy_snapshots` cada 5 min en el scheduler.

Run: `uv run pytest tests/test_fantasy.py -v` → PASS. Commit: `feat(api): fantasy con control de cambios en el servidor y snapshots al cierre de la qualy`.

---

### Tarea 8: Runner de scoring (automático, idempotente, re-scoring) y estado final

**Archivos:**
- Crear: `app/services/scoring_runner.py`, `app/worker/jobs/scoring.py`
- Modificar: `app/worker/scheduler.py` (`HANDLERS["score_event"]`, job diario `finalize_events`)
- Test: `tests/test_scoring_runner.py`

**Interfaces:**
- `async def build_event_results(db, event: Event) -> EventResults | None` (None si no hay resultado de R; pole = P1 de Q; `fastest_lap` = `fastest_lap_rank == 1` en R; `race_order` = pilotos de R con `position` no nulo ordenados; `sprint_order` idem S; `driver_team` desde `session_results.team_id` de R).
- `async def rescore_event(db, event_id: int) -> RescoreReport(users: int, prediction_points: int, fantasy_points: int, status: str)`: en **una transacción** borra `score_entries` del evento (categorías prediction y fantasy) e inserta las nuevas; actualiza `events.scoring_status`.
- `async def finalize_events(db, now) -> int`: provisional → final si `dotd_driver_id` no es nulo y `results_changed_at <= now - scoring_finalize_days`.
- Handler `score_event` para `IngestRun.target == "event:{id}"`.

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def _setup_scored_event(client, maildir, db):
    """Usuario con predicción perfecta sobre la ronda 1 de 2025 (fixtures reales)."""
    await sync_season(db, make_client(), 2025)
    ev = (await db.execute(select(Event).where(Event.season_year == 2025, Event.round == 1).options(selectinload(Event.sessions)))).scalar_one()
    await db.execute(update(Session).where(Session.event_id == ev.id).values(starts_at=datetime.now(UTC) + timedelta(days=1)))  # abrir para poder guardar
    res = await build_event_results(db, ev)
    await register_and_verify(client, maildir); await login(client)
    body = {"quali_top3": [res.pole, None, None], "sprint_top3": None, "race_top10": res.race_order[:10], "fastest_lap_driver_id": res.fastest_lap, "dotd_driver_id": None}
    assert (await client.put(f"/api/predictions/{ev.id}", json=body, headers=H)).status_code == 200
    return ev, res


async def test_rescore_is_idempotent_and_explained(client, maildir, db) -> None:
    ev, res = await _setup_scored_event(client, maildir, db)
    r1 = await rescore_event(db, ev.id); r2 = await rescore_event(db, ev.id)
    assert r1.prediction_points == r2.prediction_points == 10 + 75 + 35 + 10
    entries = (await db.execute(select(ScoreEntry).where(ScoreEntry.event_id == ev.id))).scalars().all()
    assert len(entries) == 1 and entries[0].detail["items"][0]["label"].startswith("Pole ")
    assert (await db.get(Event, ev.id)).scoring_status == "provisional"


async def test_rescore_after_dsq_replaces_entries(client, maildir, db) -> None:
    ev, res = await _setup_scored_event(client, maildir, db)
    await rescore_event(db, ev.id)
    winner = res.race_order[0]
    race = next(s for s in ev.sessions if s.type == "R")
    await db.execute(update(SessionResult).where(SessionResult.session_id == race.id, SessionResult.driver_id == winner).values(position=None, position_text="D", status="Disqualified", points=0))
    rep = await rescore_event(db, ev.id)
    assert rep.prediction_points < 10 + 75 + 35 + 10
    total = await db.scalar(select(func.sum(ScoreEntry.points)).where(ScoreEntry.event_id == ev.id))
    assert total == rep.prediction_points + rep.fantasy_points


async def test_dotd_second_pass_adds_points_and_finalize(client, maildir, db) -> None:
    ev, res = await _setup_scored_event(client, maildir, db)
    await db.execute(update(Prediction).values(dotd_driver_id=res.race_order[2]))
    base = (await rescore_event(db, ev.id)).prediction_points
    e = await db.get(Event, ev.id); e.dotd_driver_id = res.race_order[2]; e.results_changed_at = datetime.now(UTC) - timedelta(days=8)
    assert (await rescore_event(db, ev.id)).prediction_points == base + 8 + 100
    assert await finalize_events(db, now=datetime.now(UTC)) == 1
    assert (await db.get(Event, ev.id)).scoring_status == "final"


async def test_user_without_snapshot_gets_no_fantasy_points(client, maildir, db) -> None:
    ev, res = await _setup_scored_event(client, maildir, db)
    rep = await rescore_event(db, ev.id)
    assert rep.fantasy_points == 0
```

- [ ] **Paso 2: Implementación (núcleo del runner)**

```python
async def rescore_event(db: AsyncSession, event_id: int) -> RescoreReport:
    ev = await db.get(Event, event_id, options=[selectinload(Event.sessions)])
    if ev is None:
        raise ValueError(f"evento {event_id} inexistente")
    res = await build_event_results(db, ev)
    if res is None:
        return RescoreReport(0, 0, 0, ev.scoring_status)
    ruleset = get_ruleset(ev.season_year)
    codes = {d.id: d.display_code for d in (await db.execute(select(Driver))).scalars()}
    preds = (await db.execute(select(Prediction).where(Prediction.event_id == ev.id))).scalars().all()
    snaps = {s.user_id: s for s in (await db.execute(select(FantasySnapshot).where(FantasySnapshot.event_id == ev.id))).scalars()}
    rows: list[dict] = []
    for p in preds:
        b = ruleset.score_prediction(PredictionData(p.quali_top3, p.sprint_top3, p.race_top10, p.fastest_lap_driver_id, p.dotd_driver_id), res, codes)
        rows.append({"user_id": p.user_id, "season_year": ev.season_year, "event_id": ev.id, "category": "prediction", "points": b.points,
                     "detail": {"version": ruleset.version, "items": [asdict(i) for i in b.items]}})
    for uid, s in snaps.items():
        b = ruleset.score_fantasy(FantasyData(s.driver_ids, s.team_ids), res, codes)
        rows.append({"user_id": uid, "season_year": ev.season_year, "event_id": ev.id, "category": "fantasy", "points": b.points,
                     "detail": {"version": ruleset.version, "items": [asdict(i) for i in b.items]}})
    async with db.begin_nested():
        await db.execute(delete(ScoreEntry).where(ScoreEntry.event_id == ev.id, ScoreEntry.category.in_(("prediction", "fantasy"))))
        if rows:
            await db.execute(insert(ScoreEntry).values(rows))
        ev.scoring_status = "provisional"
    await db.commit()
    return RescoreReport(users=len({r["user_id"] for r in rows}),
                         prediction_points=sum(r["points"] for r in rows if r["category"] == "prediction"),
                         fantasy_points=sum(r["points"] for r in rows if r["category"] == "fantasy"), status=ev.scoring_status)
```

`finalize_events`: `UPDATE events SET scoring_status='final' WHERE scoring_status='provisional' AND dotd_driver_id IS NOT NULL AND results_changed_at <= :cutoff`. Handler: `HANDLERS["score_event"] = lambda db, run: rescore_event(db, int(run.target.split(":")[1]))`. Job `finalize_events` diario 03:00 UTC.

Run: `uv run pytest tests/test_scoring_runner.py -v` → PASS. Commit: `feat(worker): scoring automático idempotente con re-scoring, DOTD en segunda pasada y estado final`.

---

### Tarea 9: Rankings, ligas y "Adiviná el piloto"

**Archivos:**
- Crear: `app/routers/leaderboards.py`, `app/services/leagues.py`, `app/routers/leagues.py`, `app/services/guess.py`, `app/routers/guess_game.py`, `app/schemas/game.py`
- Test: `tests/test_leaderboards.py`, `tests/test_leagues.py`, `tests/test_guess.py`

**Interfaces:**
- `GET /api/leaderboards/{year}?league_id=&limit=50&offset=0 -> {rows: [{rank, user: {id, nickname, avatar_url}, points, prediction, fantasy, guess}], me: row|None, total}`. Query: `SUM(points) FILTER (WHERE category=...)` agrupado por usuario, `RANK() OVER (ORDER BY total DESC, nickname)`; con `league_id` se hace `JOIN league_members`.
- Ligas: `POST /api/leagues {name} -> LeagueOut(id, name, code, owner_id, season_year, members_count)` (máx. 5 ligas propias por usuario; código `secrets.choice` de 8 chars sin ambiguos `[A-HJ-NP-Z2-9]`), `POST /api/leagues/join {code}` (404 `league_not_found`; idempotente si ya es miembro), `GET /api/leagues/mine`, `GET /api/leagues/{id}` (solo miembros), `GET /api/leagues/{id}/leaderboard`, `DELETE /api/leagues/{id}/members/me` (salir; el owner no puede salir sin transferir: `POST /api/leagues/{id}/transfer {user_id}`).
- Adiviná: `GET /api/guess-game/today -> {games_today, wins_today, games_left, active: GameOut|None}`, `POST /api/guess-game/start -> GameOut(id, word_length, attempts: [{states}], attempts_left, status)` (429 `daily_limit` si 3/3; 409 `game_in_progress` si hay una activa), `POST /api/guess-game/{id}/guess {word} -> GameOut + (si terminó) {target: {code, name}, points}`.
- `normalize_surname(s) -> str` (NFD, sin diacríticos, mayúsculas, solo `A-ZÑ`); `evaluate(guess, target) -> list["correct"|"present"|"absent"]` (misma lógica que v2 `evaluateGuess`).
- Puntos de adiviná: al ganar, `score_entries(category="guess", day=hoy UTC)` **upsert sumando** (`points = points + :pts`) con `ON CONFLICT (user_id, day, category)`.

- [ ] **Paso 1: Tests clave (fallan primero)**

```python
# tests/test_guess.py
from app.services.guess import evaluate, normalize_surname

def test_normalize_and_evaluate() -> None:
    assert normalize_surname("Hülkenberg") == "HULKENBERG" and normalize_surname("Pérez") == "PEREZ"
    assert evaluate("SAINZ", "SAINZ") == ["correct"] * 5
    assert evaluate("ALLAN", "ALONS") == ["correct", "present", "absent", "absent", "present"]

async def test_daily_limit_and_points(client, maildir, db) -> None:
    await sync_season(db, make_client(), 2025)
    await register_and_verify(client, maildir); await login(client)
    for i in range(3):
        g = (await client.post("/api/guess-game/start", headers=H)).json()
        target = (await db.get(GuessGame, g["id"])).target_driver_id
        word = normalize_surname((await db.get(Driver, target)).last_name)
        r = (await client.post(f"/api/guess-game/{g['id']}/guess", json={"word": word}, headers=H)).json()
        assert r["status"] == "won" and r["points"] == (30 if i == 2 else 10)
    assert (await client.post("/api/guess-game/start", headers=H)).status_code == 429
    total = await db.scalar(select(func.sum(ScoreEntry.points)).where(ScoreEntry.category == "guess"))
    assert total == 50

async def test_target_never_leaks_before_end(client, maildir, db) -> None:
    await sync_season(db, make_client(), 2025); await register_and_verify(client, maildir); await login(client)
    g = (await client.post("/api/guess-game/start", headers=H)).json()
    assert "target" not in g and "target_driver_id" not in g
    r = (await client.post(f"/api/guess-game/{g['id']}/guess", json={"word": "Z" * g["word_length"]}, headers=H)).json()
    assert "target" not in r and r["attempts_left"] == 4
```

`tests/test_leaderboards.py`: 3 usuarios con `score_entries` insertados a mano (prediction 50/30/30, fantasy 10/0/20) → ranks `[1, 2, 2]`… usar `RANK()` → el empate da 2 y 2; `me` correcto; con liga de 2 miembros el ranking es solo de ellos. `tests/test_leagues.py`: crear/unirse por código/404/owner no puede salir.

- [ ] **Paso 2: Implementar y commit**

Query de ranking:

```sql
WITH totals AS (
  SELECT se.user_id,
         SUM(se.points) AS total,
         SUM(se.points) FILTER (WHERE se.category='prediction') AS prediction,
         SUM(se.points) FILTER (WHERE se.category='fantasy') AS fantasy,
         SUM(se.points) FILTER (WHERE se.category='guess') AS guess
  FROM score_entries se
  [JOIN league_members lm ON lm.user_id = se.user_id AND lm.league_id = :league_id]
  WHERE se.season_year = :year GROUP BY se.user_id)
SELECT RANK() OVER (ORDER BY total DESC, p.nickname) AS rank, p.nickname, p.avatar_url, t.* 
FROM totals t JOIN profiles p ON p.user_id = t.user_id ORDER BY rank LIMIT :limit OFFSET :offset
```

Commit: `feat(api): rankings global y por liga, ligas con código y Adiviná el piloto en el servidor`.

---

### Tarea 10: Admin por rol, auditoría y reemplazo de la protección provisoria

**Archivos:**
- Modificar: `app/routers/admin.py` (quitar `require_admin_placeholder` y `ADMIN_BOOTSTRAP_TOKEN`; usar `require_admin`)
- Crear: `app/services/admin.py` (`audit(db, user, action, target, payload)`)
- Test: `tests/test_admin.py`

**Interfaces:**
- `GET /api/admin/events?year=` (eventos con `scoring_status`, `dotd`, `results_changed_at`), `POST /api/admin/events/{id}/dotd {driver_id}` (setea y encola `score_event`), `POST /api/admin/events/{id}/rescore` (encola), `GET /api/admin/ingest-runs?status=&kind=&limit=`, `POST /api/admin/ingest-runs/{id}/retry` (vuelve a `queued`, `attempts=0`), `POST /api/admin/sync/{year}`, `POST /api/admin/sessions/{id}/ingest` (encola `fastf1_session`; la Fase 3 registra el handler), `GET /api/admin/users?q=&limit=` (id, email enmascarado, nick, rol, verificado, creado), `POST /api/admin/users/{id}/role {role}` (no puede quitarse el rol a sí mismo).
- Todo con `require_admin` y `audit(...)`.

- [ ] **Paso 1: Tests**

```python
async def test_admin_endpoints_require_role(client, maildir, db) -> None:
    await register_and_verify(client, maildir); await login(client)
    assert (await client.get("/api/admin/ingest-runs")).status_code == 403
    await db.execute(update(User).values(role="admin")); await db.commit()
    await login(client)   # nuevo access token con role=admin
    assert (await client.get("/api/admin/ingest-runs")).status_code == 200

async def test_dotd_sets_and_enqueues_and_audits(client, maildir, db) -> None:
    await sync_season(db, make_client(), 2025)
    await register_and_verify(client, maildir); await db.execute(update(User).values(role="admin")); await db.commit(); await login(client)
    ev = (await db.execute(select(Event).where(Event.season_year == 2025, Event.round == 1))).scalar_one()
    driver_id = await db.scalar(select(Driver.id).where(Driver.code == "VER"))
    r = await client.post(f"/api/admin/events/{ev.id}/dotd", json={"driver_id": driver_id}, headers=H)
    assert r.status_code == 200 and (await db.get(Event, ev.id)).dotd_driver_id == driver_id
    runs = (await db.execute(select(IngestRun).where(IngestRun.kind == "score_event", IngestRun.target == f"event:{ev.id}"))).scalars().all()
    assert len(runs) == 1
    audit = (await db.execute(select(AdminAuditLog).where(AdminAuditLog.action == "set_dotd"))).scalar_one()
    assert audit.target == f"event:{ev.id}" and audit.payload["driver_id"] == driver_id


async def test_admin_cannot_demote_self(client, maildir, db) -> None:
    await register_and_verify(client, maildir); await db.execute(update(User).values(role="admin")); await db.commit(); await login(client)
    me = (await client.get("/api/me")).json()
    r = await client.post(f"/api/admin/users/{me['id']}/role", json={"role": "user"}, headers=H)
    assert r.status_code == 409 and r.json()["code"] == "cannot_demote_self"
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(api): admin con rol en DB, Piloto del Día, recalcular, reintentos de ingesta y auditoría`.

---

### Tarea 11: Seed de usuarios de prueba y datos sintéticos

**Archivos:**
- Crear: `app/seed.py`
- Modificar: `apps/api/.env.example` (`SEED_PASSWORD=F1pp-Dev-2026!`), `app/config.py` (`seed_password`)
- Test: `tests/test_seed.py`

**Interfaces:**
- `uv run python -m app.seed [--reset] [--year 2026] [--synthetic 200]`: crea los usuarios del plan maestro §3.7 (`admin`, `ana_f1`, `bruno`, `carla` sin verificar, `dario` vacío), fantasy de `ana`, predicciones de `ana` y de los 200 sintéticos para los eventos ya corridos del año (aleatorias válidas), liga `Liga de amigos` de `bruno` con código fijo `AMIGOS26` y miembros `ana`, `dario`; snapshots para eventos cerrados; encola `score_event` para eventos con resultado y corre la cola (`run_queue_once` en bucle). Se niega a correr si `settings.env == "prod"`.
- `--reset`: borra usuarios cuyo email termina en `@f1pp.test` (cascada) y vuelve a crear.

- [ ] **Paso 1: Test**

```python
async def test_seed_creates_users_and_scores(db: AsyncSession) -> None:
    await sync_season(db, make_client(), 2025)
    await seed(db, year=2025, synthetic=20, reset=True)
    assert await db.scalar(select(func.count()).select_from(User).where(User.email.like("%@f1pp.test"))) == 25
    carla = await db.scalar(select(User).where(User.email == "carla@f1pp.test")); assert not carla.is_verified
    assert await db.scalar(select(func.count()).select_from(ScoreEntry)) > 0
    assert await db.scalar(select(League.code).where(League.code == "AMIGOS26")) == "AMIGOS26"
```

- [ ] **Paso 2: Implementar, correr contra la DB local con 2026 y commit**

```bash
cd apps/api && uv run python -m app.seed --reset --year 2026 --synthetic 200
```

Expected: `seed: 205 usuarios, N predicciones, M score_entries, liga AMIGOS26`. Commit: `feat(api): seed de usuarios de prueba y datos sintéticos para rankings`.

---

### Tarea 12: Web — Auth, perfil y guardas de ruta

**Archivos:**
- Crear: `src/auth/AuthProvider.tsx` (`useMe()` con `GET /api/me`; `401` → `null`), `src/auth/useAuth.ts`, `src/auth/RequireAuth.tsx`, `src/auth/RequireAdmin.tsx`, `src/api/auth.ts` (mutations: `useLogin`, `useRegister`, `useLogout`, `useVerify`, `useForgot`, `useReset`, `useResend`, `useUpdateProfile`, `useChangePassword`, `useDeleteAccount`)
- Crear: `src/features/auth/LoginPage.tsx`, `RegisterPage.tsx`, `VerifyPage.tsx`, `ForgotPage.tsx`, `ResetPage.tsx`, `src/features/profile/ProfilePage.tsx`, `src/components/ui/{Button,Input,Field,Modal,Toast,Card}.tsx`
- Modificar: `src/api/client.ts` (en `401` con `code` `token_expired`: un intento de `POST /api/auth/refresh` y reintento de la request original; en fallo → `queryClient.setQueryData(['me'], null)`), `src/routes.tsx`, `src/components/layout/Navbar.tsx` (slot usuario: nick + menú con Perfil / Admin / Cerrar sesión), `src/i18n/es.ts`
- Test: `tests/auth.test.tsx` (RequireAuth redirige a `/ingresar` con `?next=`; refresh automático en 401)

**Interfaces:**
- `useAuth(): { user: MeOut | null, isLoading: boolean, isAdmin: boolean, logout(): Promise<void> }`.
- Formularios con `autocomplete` correcto, validación en cliente **solo como ayuda** (longitud, confirmación) y mensajes de la API (`detail`) como fuente de verdad.
- `Modal` accesible: `role="dialog"`, `aria-modal`, foco atrapado, Escape, portal, cierre por backdrop (v2 no tenía nada de esto).

- [ ] **Paso 1: Tests, implementación, verificación en navegador, commit**

Verificación en navegador interno (móvil y desktop):
1. `/registro` con un email nuevo `prueba1@f1pp.test` → mensaje "Te enviamos un email…"; abrir `apps/api/.dev-mail/` (último `.eml`), copiar el link `/verificar?token=…`, navegar → "Email verificado" → `/ingresar` → entra → Navbar muestra el nick.
2. Login como `carla@f1pp.test` → mensaje "Tenés que verificar tu email" con botón "Reenviar".
3. Login fallido 6 veces → mensaje de "Demasiados intentos".
4. `/perfil`: cambiar nick; cambiar contraseña; modal de borrado (cancelar).
5. `read_console_messages onlyErrors` vacío; cookies `HttpOnly` visibles en `read_network_requests` (`set-cookie` con `HttpOnly; SameSite=Lax`).

Commit: `feat(web): auth completa (registro, verificación, login, reset), perfil y guardas de ruta`.

---

### Tarea 13: Web — Predicciones, Mi equipo, Rankings, Ligas, Adiviná, Reglas

**Archivos:**
- Crear: `src/features/predictions/PredictionsListPage.tsx` (`/predicciones`: eventos del año con estado "Abierta hasta {fecha}" / "Cerrada" / "Puntuada: N pts"), `PredictionPage.tsx` (`/predicciones/:eventId`, migrada de v2), `DriverPicker.tsx` (en móvil: bottom-sheet con búsqueda y lista de pilotos con color de equipo, objetivos 48 px; en desktop: `<select>` nativo), `PredictionHistory.tsx` (desglose `detail.items` en lista)
- Crear: `src/features/fantasy/MyTeamPage.tsx` (`/mi-equipo`, migrada de v2 `MyTeamPage` + `DriverSelectItem` + `TeamSelectItem`; muestra `changes_remaining` del servidor y último snapshot)
- Crear: `src/features/leaderboards/RankingsPage.tsx` (`/rankings`: tabs Global / Mis ligas; tabla → tarjetas en móvil; fila "Vos" fija arriba), `src/features/leagues/{NewLeaguePage,JoinLeaguePage,LeaguePage}.tsx` (`/ligas/nueva`, `/ligas/unirse`, `/ligas/:id`: código para compartir con botón "Copiar" y Web Share API en móvil)
- Crear: `src/features/guess/GuessGamePage.tsx` (`/adivina-el-piloto`; migrar `components/game/{Keyboard,KeyboardKey,GuessInputRow}.tsx` de v2 a `src/features/guess/components/`, quitando la lógica de evaluación y el objetivo del cliente: solo pinta `attempts[].states`)
- Crear: `src/features/rules/RulesPage.tsx` (`/reglas`: renderiza `RULES` desde `GET /api/rules` que expone `RULES`, `RACE_POINTS`, `SPRINT_POINTS` y constantes de adiviná para no duplicarlas)
- Modificar: `src/routes.tsx`, `src/i18n/es.ts`, `src/components/layout/navItems.ts` (página `/mas` con la lista: Campeonato, Estadísticas (deshabilitada hasta 1b), Mi equipo, Adiviná, Reglas, Perfil, Admin)
- Test: `tests/PredictionPage.test.tsx` (muestra "Cerrada" y deshabilita inputs cuando `locks.main_locked`), `tests/GuessGame.test.tsx` (teclado pinta estados), `tests/Rankings.test.tsx` (fila "Vos")

- [ ] **Paso 1: Tests, implementación, verificación en navegador, commit**

Verificación en navegador interno con usuarios seed, móvil (375×812) y desktop, screenshot de cada pantalla:
1. `ana`: `/predicciones` → próximo evento "Abierta" → formulario; `DriverPicker` en móvil abre bottom-sheet; guardar → toast "Predicción guardada"; recargar → persiste. Evento pasado → "Cerrada", inputs deshabilitados, desglose de puntos visible.
2. `ana`: `/mi-equipo` → cambiar un piloto → guardar → "Cambios restantes: 4".
3. `/rankings`: 205 usuarios, paginación, fila "Vos"; tab liga "Liga de amigos" con 3 miembros.
4. `dario`: `/ligas/unirse` con `AMIGOS26` → ya es miembro (mensaje idempotente); `/ligas/nueva` crea una y muestra el código.
5. `/adivina-el-piloto`: jugar una partida completa con el teclado en pantalla (móvil) y el físico (desktop); al perder muestra el apellido; a la 4ª partida "Volvé mañana".
6. `/reglas` legible en móvil.
7. Consola sin errores; sin scroll horizontal en ninguna pantalla.

Commit: `feat(web): predicciones, mi equipo, rankings, ligas, adiviná el piloto y reglas`.

---

### Tarea 14: Web — Panel admin

**Archivos:**
- Crear: `src/features/admin/AdminPage.tsx` (`/admin`, `RequireAdmin`): tabs **Eventos** (tabla: ronda, nombre, estado de puntaje, DOTD con `DriverPicker`, botones "Guardar DOTD" y "Recalcular"), **Ingesta** (tabla de `ingest_runs` con filtros, error expandible, "Reintentar", "Sync temporada"), **Usuarios** (búsqueda, rol).
- Test: `tests/Admin.test.tsx` (usuario no admin → redirige a `/`).

- [ ] **Paso 1: Implementar, verificar en navegador (como `admin@f1pp.test`: cargar DOTD de un evento pasado → en ≤ 30 s el worker recalcula y `/rankings` cambia; reintentar un run fallido), commit**

Commit: `feat(web): panel admin (Piloto del Día, recalcular, cola de ingesta, usuarios)`.

---

### Tarea 15: E2E Playwright de los flujos de juego

**Archivos:**
- Crear: `apps/web/e2e/global-setup.ts` (corre `uv run python -m app.seed --reset --year <año>` vía `child_process`), `e2e/auth.spec.ts`, `e2e/prediction.spec.ts`, `e2e/fantasy.spec.ts`, `e2e/guess.spec.ts`, `e2e/admin.spec.ts`, `e2e/helpers.ts` (`loginAs(page, 'ana')` leyendo `SEED_PASSWORD` de env)
- Modificar: `.github/workflows/ci.yml` (job `e2e` ya existe: agregar seed y `SEED_PASSWORD`)

- [ ] **Paso 1: Specs**

`auth.spec.ts`: registro → lee el `.eml` más nuevo de `apps/api/.dev-mail` (fs) → verifica → login → nick en Navbar; login de `carla` bloqueado. `prediction.spec.ts`: `ana` guarda y recarga; evento cerrado muestra "Cerrada". `fantasy.spec.ts`: cambio consume 1. `guess.spec.ts`: partida completa con teclado en pantalla en el proyecto `mobile`. `admin.spec.ts`: `admin` carga DOTD y ve "Recalculo encolado".

- [ ] **Paso 2: Correr local y en CI, commit**

Run: `npm run e2e` → PASS en `desktop` y `mobile`. Commit: `test(web): e2e de auth, predicciones, fantasy, adiviná y admin`.

---

### Tarea 16: Endurecimiento final y revisión de seguridad

- [ ] Quitar `|| true` de `pip-audit` en CI; `npm audit --audit-level=high` ya bloquea.
- [ ] Revisar con `/security-review` el diff de la rama `fase-2/usuarios-y-juego` y corregir hallazgos.
- [ ] Verificar manualmente: `curl -i -X POST https://<dominio>/api/auth/login` sin header → 403 `csrf`; con `Origin` ajeno → 403; cookies con `Secure` en prod; `GET /api/admin/ingest-runs` sin sesión → 401; con usuario normal → 403.
- [ ] Confirmar que ningún endpoint acepta `points` en el body (grep `points` en `app/schemas/*In`).
- [ ] Commit: `chore(seguridad): endurecimiento de CI y verificación manual de auth`.

---

## Criterio de "listo" de la Fase 2

- [ ] `uv run pytest` verde incluyendo `tests/scoring` (casos reales de 2025 con DSQ posterior) y `tests/auth`.
- [ ] No existe ningún endpoint que escriba `score_entries` desde el cliente; el scoring solo lo ejecuta el worker (`score_event`) o lo encola el admin.
- [ ] Seed crea los usuarios de prueba de §3.7 y 200 sintéticos; el ranking los muestra.
- [ ] Flujos verificados en el navegador interno en móvil y desktop: registro+verificación, login bloqueado sin verificar, predicción abierta/cerrada, fantasy con cambios, rankings y ligas, adiviná, perfil y borrado, admin DOTD → recálculo automático.
- [ ] E2E Playwright verdes en desktop y móvil en CI.
- [ ] `/security-review` sin hallazgos altos.
