# Fase 3 — Análisis de sesión (port de f1-race-replay + FastF1 + OpenF1): plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`). Esta fase es XL: cada tarea es un PR.

**Objetivo:** Portar la capa de datos de `f1-race-replay` (sin GUI) a `apps/api/f1data`, ingerir automáticamente cada sesión 2018+ después de que termina (vueltas extendidas, stints, pits, race control, clima, circuito, resultados extendidos y telemetría completa en Parquet), complementar 2023+ con OpenF1 (intervalos, adelantamientos, radio, tiempo detenido en pits), hacer el backfill 2018→hoy retomable, y construir las páginas de análisis y el comparador de telemetría.

**Arquitectura:** `f1data/` es un paquete Python puro (fastf1 + numpy + pandas + scipy + pyarrow) sin `print`, `pickle`, `sys.argv` ni `multiprocessing` global. El worker ejecuta los handlers `fastf1_session`, `openf1_session` y `parquet_session` de la cola `ingest_runs`, de a una sesión por vez (advisory lock), con FastF1 fijado en 3.8.3 y un test de contrato de su API privada. Un scheduler encola cada sesión 45 min después de su fin estimado y reintenta con backoff si FastF1 todavía no tiene datos. La API lee Postgres para vueltas/eventos y DuckDB sobre Parquet para telemetría.

**Tech Stack:** fastf1 3.8.3 (pandas<3), scipy (cKDTree), pyarrow + zstd, duckdb, httpx (OpenF1 3 req/s, 30 req/min); web: uPlot (series largas), SVG (estrategia), Canvas 2D (mapa con curvas), Web Worker para procesar telemetría.

**Spec:** `propuesta.md` §1 (tabla de módulos), §2.2, §4.1 (filas FastF1, OpenF1, circuito, gaps), §4.2 "Timing", §4.4 (correcciones obligatorias), §4.5, §7 (Evento, Análisis), §8, §10 fila "3". **Plan maestro:** §1 D2, D6; §3.2.

## Restricciones globales

- FastF1 **3.8.3** exacto. API privada `fastf1._api._extended_timing_data(session.api_path)` → `(laps_data, stream_data, session_split_times)`; `stream_data` con columnas `Driver, Time, Position, GapToLeader, IntervalToPositionAhead` (2018–2022). 2023+ gaps desde OpenF1 `intervals` (pública).
- Worker: 1 sesión a la vez; máximo 2 procesos (`F1DATA_PROCESSES=2`); borrar el caché de FastF1 de la sesión al terminar; RAM < 4 GB.
- Telemetría completa **no va a Postgres**: Parquet por sesión en `/data/telemetry/{year}/{session_id}.parquet` (zstd).
- OpenF1 histórico: 3 req/s, 30 req/min, desde 2023; `pit.stop_duration` desde GP EE.UU. 2024; `overtakes` solo carreras y pueden estar incompletos; `team_radio` cobertura reducida desde 2026.
- Correcciones de §4.4: `dist` = distancia **dentro de la vuelta**; muestreo por escalón para categorías; posición desde el stream de timing/OpenF1 y `out` al terminar la telemetría; gaps oficiales; formato único de telemetría (Parquet) para todas las sesiones.
- MIT: `THIRD_PARTY_NOTICES.md` ya atribuye; cada archivo portado lleva cabecera `# Derivado de f1-race-replay (MIT, © Tom Shaw) — commit 8136931`.

## Foco de revisión

1. **Sesión sin datos en FastF1** (cancelada, archivo faltante, `DataNotLoadedError`): `ingest_runs` → `queued` con `next_attempt_at` +2 h hasta 6 intentos, luego `failed` con error legible; nunca bloquea la cola. Test T6.
2. **Piloto que abandona:** la telemetría termina antes; `out=True` desde ese `t`; las vueltas posteriores no existen en `laps`; el resultado dice `R`. Test T3 con una carrera con abandono (Bahréin 2024, Stroll? usar fixture pequeña sintética).
3. **Cambio de versión de FastF1 por Dependabot:** el test de contrato (`-m network`) corre semanalmente y en cualquier PR que toque `pyproject.toml`; falla si cambia la firma o las columnas. T1.
4. **Parquet parcial por corte del worker:** se escribe a `*.parquet.tmp` y se renombra al final; `telemetry_files` se inserta después del rename. Test T5.
5. **Telemetría de qualy con vueltas sin posición** (`X/Y` NaN): se descartan filas sin posición y se marca `has_position=false` en el resumen; el comparador oculta el mapa. Test T5.

---

### Tarea 1: Paquete `f1data`, dependencias y test de contrato de FastF1

**Archivos:**
- Modificar: `apps/api/pyproject.toml` (grupo `f1data`: `fastf1==3.8.3`, `pandas>=2.2,<3`, `numpy>=2,<3`, `scipy>=1.11,<2`, `pyarrow>=26,<27`, `duckdb>=1.5,<1.6`, `matplotlib>=3.8,<4` (dependencia de fastf1), `rapidfuzz`)
- Crear: `apps/api/f1data/__init__.py`, `f1data/session_loader.py`, `f1data/lib/__init__.py`, `f1data/lib/sectors.py`, `f1data/lib/tyres.py`, `f1data/lib/time.py` (copiados tal cual de upstream `src/lib/` con cabecera de atribución), `tests/f1data/lib/test_sectors.py`, `test_time.py`, `test_tyres.py` (copiados de upstream `tests/lib/`)
- Crear: `tests/f1data/test_fastf1_contract.py`
- Modificar: `.github/workflows/ci.yml` (job `fastf1-contract` semanal `cron: "0 6 * * 1"` y en PRs que cambian `apps/api/pyproject.toml`; cachea `~/.cache/fastf1`)

**Interfaces:**
- `session_loader.py`: `FASTF1_IDENT = {"FP1":"FP1","FP2":"FP2","FP3":"FP3","Q":"Q","SQ":"SQ","S":"S","R":"R"}` + `def fastf1_identifier(session_type: str, year: int) -> str` (`SQ` → `"SS"` en 2023); `def enable_cache(path: Path) -> None`; `def load_session(year: int, round: int, session_type: str, *, laps=True, telemetry=True, weather=True, messages=True) -> fastf1.core.Session` (lanza `SessionDataUnavailable` si FastF1 no tiene datos); `def clear_session_cache(cache_dir, year, round, session_type) -> None`.
- `f1data/lib/time.py`: `parse_time_string(s) -> float|None`, `format_lap_time(seconds) -> str` (upstream).
- `f1data/lib/tyres.py`: `get_tyre_compound_int(compound: str) -> int` (0 blando, 1 medio, 2 duro, 3 intermedio, 4 lluvia; upstream).
- `f1data/lib/sectors.py`: `best_sectors(laps) -> dict`, `theoretical_lap(...)`, `pb_sb_flags(...)` (upstream).

- [ ] **Paso 1: Instalar y copiar lib con sus tests**

```bash
cd apps/api && uv add --group f1data "fastf1==3.8.3" "pandas>=2.2,<3" "numpy>=2,<3" "scipy>=1.11,<2" "pyarrow>=26,<27" "duckdb>=1.5,<1.6" "matplotlib>=3.8,<4"
git clone --depth 1 https://github.com/IAmTomShaw/f1-race-replay /tmp/f1rr && cd /tmp/f1rr && git checkout 8136931 2>/dev/null || true
cp /tmp/f1rr/src/lib/{sectors,tyres,time}.py apps/api/f1data/lib/ && cp /tmp/f1rr/tests/lib/test_{sectors,tyres,time}.py apps/api/tests/f1data/lib/
```

Ajustar imports `from src.lib.x` → `from f1data.lib.x`, agregar la cabecera de atribución. Run: `uv run pytest tests/f1data/lib -v` → PASS (son los tests upstream).

- [ ] **Paso 2: Test de contrato (falla si cambia FastF1)**

```python
import pytest
import fastf1
from fastf1 import _api as ffapi

pytestmark = pytest.mark.network
EXPECTED_LAPS_COLS = {"Time", "Driver", "DriverNumber", "LapTime", "LapNumber", "Stint", "PitOutTime", "PitInTime", "Sector1Time", "Sector2Time", "Sector3Time",
                      "Sector1SessionTime", "Sector2SessionTime", "Sector3SessionTime", "SpeedI1", "SpeedI2", "SpeedFL", "SpeedST", "IsPersonalBest", "Compound",
                      "TyreLife", "FreshTyre", "Team", "LapStartTime", "LapStartDate", "TrackStatus", "Position", "Deleted", "DeletedReason", "FastF1Generated", "IsAccurate"}
EXPECTED_RESULTS_COLS = {"DriverNumber", "BroadcastName", "Abbreviation", "DriverId", "TeamName", "TeamColor", "TeamId", "FirstName", "LastName", "FullName",
                         "HeadshotUrl", "CountryCode", "Position", "ClassifiedPosition", "GridPosition", "Q1", "Q2", "Q3", "Time", "Status", "Points", "Laps"}
EXPECTED_TEL_COLS = {"Date", "SessionTime", "DriverAhead", "DistanceToDriverAhead", "Time", "RPM", "Speed", "nGear", "Throttle", "Brake", "DRS", "Source", "Distance", "RelativeDistance", "Status", "X", "Y", "Z"}


@pytest.fixture(scope="module")
def session():
    assert fastf1.__version__ == "3.8.3"
    fastf1.Cache.enable_cache(".fastf1-cache")
    s = fastf1.get_session(2022, 1, "R")   # Bahréin 2022: época de API privada
    s.load(laps=True, telemetry=True, weather=True, messages=True)
    return s


def test_public_surfaces(session) -> None:
    assert EXPECTED_LAPS_COLS <= set(session.laps.columns)
    assert EXPECTED_RESULTS_COLS <= set(session.results.columns)
    assert {"Time", "Category", "Message", "Status", "Flag", "Scope", "Sector", "RacingNumber", "Lap"} <= set(session.race_control_messages.columns)
    assert {"Time", "AirTemp", "Humidity", "Pressure", "Rainfall", "TrackTemp", "WindDirection", "WindSpeed"} <= set(session.weather_data.columns)
    assert {"Time", "Status", "Message"} <= set(session.track_status.columns)
    ci = session.get_circuit_info()
    assert {"X", "Y", "Number", "Letter", "Angle", "Distance"} <= set(ci.corners.columns) and isinstance(ci.rotation, float)
    tel = session.laps.pick_drivers("VER").pick_fastest().get_telemetry()
    assert EXPECTED_TEL_COLS <= set(tel.columns)


def test_private_extended_timing_data(session) -> None:
    out = ffapi._extended_timing_data(session.api_path)
    assert isinstance(out, tuple) and len(out) == 3
    laps_data, stream_data, _ = out
    assert {"Driver", "Time", "Position", "GapToLeader", "IntervalToPositionAhead"} <= set(stream_data.columns)
    assert len(stream_data) > 1000
```

Run: `uv run pytest tests/f1data/test_fastf1_contract.py -m network -v` → PASS (≈ 2 min la primera vez). Commit: `feat(f1data): paquete base, lib de upstream con tests y contrato de FastF1 3.8.3`.

---

### Tarea 2: Modelos de timing + migración

**Archivos:**
- Crear: `app/models/timing.py`; modificar `app/models/results.py` (`classified_position`, `headshot_url`, `team_color` en `SessionResult`) y `app/models/reference.py` (`CircuitMarker`)
- Crear: `alembic/versions/0005_timing.py`
- Test: `tests/test_models_timing.py`

**Interfaces (tablas):**
- `laps(id, session_id, driver_id, number, time_ms, s1_ms, s2_ms, s3_ms, speed_i1, speed_i2, speed_fl, speed_st, compound (str), tyre_life, fresh_tyre, stint, pit_in_ms, pit_out_ms, position, is_pb, deleted, deleted_reason, is_accurate, generated, track_status (str), lap_start_ms, gap_to_leader_ms, interval_ms, is_pit_entry, is_pit_exit, is_outlier, pit_confidence)` — `UNIQUE(session_id, driver_id, number)`, índice `(session_id, number)`.
- `stints(id, session_id, driver_id, number, compound, lap_start, lap_end, tyre_age_start)`.
- `pit_stops(id, session_id, driver_id, lap, lane_ms, stop_ms, at_ms)`.
- `race_control_messages(id, session_id, at_ms, lap, category, flag, scope, sector, driver_number, message)`.
- `weather_samples(id, session_id, at_ms, air_temp, track_temp, humidity, pressure, rainfall, wind_speed, wind_dir)`.
- `track_status_changes(id, session_id, at_ms, status (str '1'..'7'), message)`.
- `overtakes(id, session_id, at_ms, overtaking_driver_id, overtaken_driver_id, position)`.
- `team_radio(id, session_id, driver_id, at_ms, recording_url)`.
- `circuit_markers(id, circuit_id, season_year, kind ('corner'|'marshal_light'|'marshal_sector'), number, letter, x, y, angle, distance)` + `circuit_layouts(id, circuit_id, season_year, rotation, lap_length_m, polyline (JSONB [[x,y],…] remuestreada a 2000 pts), inner_edge, outer_edge, drs_zones (JSONB [[start_m,end_m],…]))`.
- `telemetry_files(id, session_id UNIQUE, path, rows, bytes, has_position, created_at)`.
- `sessions` + columnas: `ingest_status` (`none|partial|complete|failed`), `fastf1_ident`, `duration_min` (estimada: FP 60, Q 60, SQ 45, S 40, R 130), `next_ingest_attempt_at`.

- [ ] **Paso 1: Test, modelos, migración, commit**

`uv run alembic revision --autogenerate -m "timing" --rev-id 0005`. Commit: `feat(api): modelos de vueltas, stints, pits, race control, clima, circuito y telemetría`.

---

### Tarea 3: Port de vueltas y clasificación (de `race_replay.py:367-1175`)

**Archivos:**
- Crear: `f1data/laps.py`, `f1data/pits.py`, `f1data/status.py`
- Test: `tests/f1data/test_laps.py` (fixture: `tests/f1data/fixtures/laps_2024_r04_small.parquet` = `session.laps` de 3 pilotos de una carrera, 2 de ellos con pit y uno con abandono, generada una vez con un script `make_fixture.py` marcado `network`)

**Interfaces:**
- `extract_laps(session) -> pd.DataFrame` con las columnas de la tabla `laps` (sin gaps), tiempos en ms enteros (`NaT` → `None`), `track_status` como str.
- `classify_laps(df: pd.DataFrame, *, min_lap_s=30, max_lap_s=7200) -> pd.DataFrame`: agrega `is_pit_entry` (`pit_in_ms` no nulo), `is_pit_exit` (`pit_out_ms` no nulo), `is_outlier` (vuelta > `base_pace * 1.07` sin ser pit ni bajo SC/VSC/roja), `pit_confidence` (`official` si viene de `PitInTime`, `high` si la vuelta y la siguiente superan el umbral, `medium` si solo una, `none`). Port directo de `_classify_lap_entries` y de la heurística de `_compute_fallback_lap_times_raw`.
- `base_pace(df) -> float` (mediana de vueltas limpias: no pit, no outlier, `track_status == '1'`), port de "ritmo base".
- `fill_tyre_life(df) -> pd.DataFrame` (port de `_fill_missing_official_tyre_life`: rellena `tyre_life` dentro de cada stint).
- `pits.py`: `extract_stints(df_laps) -> pd.DataFrame(stints)`, `extract_pit_stops(session, df_laps) -> pd.DataFrame(pit_stops)` (`lane_ms = pit_out - pit_in` de vueltas consecutivas; `stop_ms` nulo hasta OpenF1).
- `status.py`: `track_status_changes(session) -> pd.DataFrame`, `status_lap_ranges(df_laps, changes) -> list[dict(status, lap_from, lap_to)]` (port de `_compute_status_laps`: rangos de vueltas con SC '4', VSC '6'/'7', roja '5').

- [ ] **Paso 1: Tests (fallan primero)**

```python
import pandas as pd
from f1data.laps import base_pace, classify_laps, fill_tyre_life
from f1data.status import status_lap_ranges

def test_classify_marks_pits_and_outliers(laps_fixture: pd.DataFrame) -> None:
    out = classify_laps(laps_fixture)
    ver = out[out.driver == "VER"]
    assert ver.loc[ver.number == 17, "is_pit_entry"].item() and ver.loc[ver.number == 18, "is_pit_exit"].item()
    assert ver.loc[ver.number == 17, "pit_confidence"].item() == "official"
    assert not ver.loc[ver.number == 10, "is_outlier"].item()
    assert out[(out.driver == "STR") & (out.number == 25)].empty    # abandonó en la 24

def test_base_pace_ignores_pits_and_sc(laps_fixture) -> None:
    bp = base_pace(classify_laps(laps_fixture))
    assert 90_000 < bp < 100_000

def test_fill_tyre_life_within_stint(laps_fixture) -> None:
    df = laps_fixture.copy(); df.loc[(df.driver == "VER") & (df.number == 5), "tyre_life"] = None
    assert fill_tyre_life(df).query("driver=='VER' and number==5").tyre_life.item() == 5

def test_status_lap_ranges_sc(laps_fixture, status_changes_fixture) -> None:
    rng = status_lap_ranges(laps_fixture, status_changes_fixture)
    assert {"status": "4", "lap_from": 30, "lap_to": 33} in rng
```

- [ ] **Paso 2: Implementación (núcleo de `classify_laps`)**

```python
OUTLIER_FACTOR = 1.07
CLEAN = "1"


def base_pace(df: pd.DataFrame) -> float:
    clean = df[(~df.is_pit_entry) & (~df.is_pit_exit) & (df.track_status == CLEAN) & df.time_ms.notna() & df.is_accurate]
    return float(clean.time_ms.median()) if len(clean) else float(df.time_ms.median())


def classify_laps(df: pd.DataFrame, *, min_lap_s: float = 30, max_lap_s: float = 7200) -> pd.DataFrame:
    df = df.sort_values(["driver", "number"]).copy()
    df["is_pit_entry"] = df.pit_in_ms.notna()
    df["is_pit_exit"] = df.pit_out_ms.notna()
    df["pit_confidence"] = np.where(df.is_pit_entry, "official", "none")
    df["is_outlier"] = False
    valid = df.time_ms.between(min_lap_s * 1000, max_lap_s * 1000)
    df.loc[~valid & df.time_ms.notna(), "is_outlier"] = True
    bp = base_pace(df)
    thr = bp * OUTLIER_FACTOR
    for drv, g in df.groupby("driver"):
        idx = g.index.to_list()
        for i, ix in enumerate(idx):
            row = df.loc[ix]
            slow = row.time_ms is not None and not pd.isna(row.time_ms) and row.time_ms > thr
            under_flag = any(ch in str(row.track_status) for ch in ("4", "5", "6", "7"))
            if slow and not row.is_pit_entry and not row.is_pit_exit and not under_flag:
                nxt_slow = i + 1 < len(idx) and df.loc[idx[i + 1]].time_ms > thr
                if nxt_slow:                      # entrada + salida de pit sin dato oficial
                    df.loc[ix, ["is_pit_entry", "pit_confidence"]] = [True, "high"]
                    df.loc[idx[i + 1], "is_pit_exit"] = True
                elif i > 0 and df.loc[idx[i - 1]].is_pit_entry:
                    df.loc[ix, ["is_pit_exit", "pit_confidence"]] = [True, "medium"]
                else:
                    df.loc[ix, "is_outlier"] = True
    return df
```

Run: `uv run pytest tests/f1data/test_laps.py -v` → PASS. Commit: `feat(f1data): extracción y clasificación de vueltas, stints, pits y rangos de estado de pista`.

---

### Tarea 4: Gaps oficiales (FastF1 privado 2018–2022, OpenF1 2023+) y cliente OpenF1

**Archivos:**
- Crear: `f1data/gaps.py`, `app/services/openf1.py`
- Test: `tests/f1data/test_gaps.py` (fixture `stream_data_small.parquet` con 2 pilotos × 5 vueltas), `tests/test_openf1_client.py` (MockTransport)

**Interfaces:**
- `gaps_from_stream(stream_data: pd.DataFrame, laps: pd.DataFrame) -> pd.DataFrame[driver, number, gap_to_leader_ms, interval_ms, position]`: para cada vuelta, toma la fila del stream más cercana a `lap_start_ms + time_ms` (fin de vuelta) por piloto; `GapToLeader` puede ser `"+1 LAP"`/`"LAP 12"` → `None` + `laps_down` (port de `_parse_timing_delta` y de la "escalera" coherente: si `GapToLeader` falta, se reconstruye sumando `IntervalToPositionAhead` por posición).
- `gaps_from_openf1(intervals: list[dict], laps: pd.DataFrame, drivers_by_number: dict[int, str]) -> pd.DataFrame` (misma salida; `gap_to_leader`/`interval` numéricos o `"+1 LAP"`).
- `OpenF1Client(http, limiter=AsyncRateLimiter(3, 30*60))` — ojo: el límite real es 30 req/min; se modela con `per_second=3` y `per_hour=1800` **más** una ventana por minuto (`AsyncRateLimiter` recibe `per_minute=30` opcional; agregarlo a la clase de la Fase 1a). Métodos: `sessions(year, date_from, date_to)`, `intervals(session_key)`, `position(session_key)`, `overtakes(session_key)`, `pit(session_key)`, `team_radio(session_key)`, `stints(session_key)`, `session_result(session_key)`, `starting_grid(session_key)`, `drivers(session_key)`. Paginación: OpenF1 no pagina; filtra por `date>` cuando la respuesta supera 10k filas (`intervals`, `position`): bucle con `date>{último date}`.
- `find_openf1_session_key(client, session: Session, event: Event) -> int | None`: `/v1/sessions?year=&date_start>=starts_at-2h&date_start<=starts_at+2h` y `session_name` ∈ mapa `{"FP1":"Practice 1","FP2":"Practice 2","FP3":"Practice 3","SQ":"Sprint Qualifying"|"Sprint Shootout","S":"Sprint","Q":"Qualifying","R":"Race"}`.

- [ ] **Paso 1: Tests, implementación, commit**

Test clave: `test_gap_ladder_reconstructed_when_leader_gap_missing` (filas con `GapToLeader=""` pero `IntervalToPositionAhead` numérico → suma acumulada por posición) y `test_lapped_driver_has_laps_down` (`"+1 LAP"` → `gap_to_leader_ms=None, laps_down=1`). Commit: `feat(f1data): gaps oficiales desde FastF1 (2018–2022) y OpenF1 (2023+), cliente OpenF1`.

---

### Tarea 5: Circuito, telemetría completa a Parquet y lector DuckDB

**Archivos:**
- Crear: `f1data/circuit.py`, `f1data/parquet_writer.py`, `app/services/telemetry_reader.py`
- Test: `tests/f1data/test_circuit.py`, `tests/f1data/test_parquet.py`, `tests/test_telemetry_reader.py`

**Interfaces:**
- `circuit.py` (port de `ui_components` bordes/DRS + `f1_data.get_circuit_rotation`): `reference_lap(session) -> pd.DataFrame` (vuelta más rápida con posición), `layout_from_reference(ref: pd.DataFrame, *, n=2000, half_width_m=7.0) -> Layout(polyline, inner_edge, outer_edge, lap_length_m)` (remuestreo por distancia con `np.interp`, normales por diferencias finitas), `drs_zones(ref) -> list[tuple[float, float]]` (tramos con `DRS in (10,12,14)` sobre `Distance`), `markers(session) -> list[dict]` (corners, marshal lights/sectors), `rotation(session) -> float`.
- `parquet_writer.py`: `TELEMETRY_SCHEMA = pa.schema([("driver", pa.string()), ("number", pa.int16()), ("lap", pa.int16()), ("t_ms", pa.int32()) /*SessionTime*/, ("x", pa.float32()), ("y", pa.float32()), ("z", pa.float32()), ("speed", pa.int16()), ("rpm", pa.int16()), ("gear", pa.int8()), ("throttle", pa.int8()), ("brake", pa.bool_()), ("drs", pa.int8()), ("distance", pa.float32()), ("rel_distance", pa.float32()), ("on_track", pa.bool_()), ("driver_ahead", pa.string()), ("dist_ahead", pa.float32())])`; `write_session_telemetry(session, out_path: Path, *, drivers: list[str] | None = None) -> TelemetryStats(rows, bytes, has_position, laps_written, laps_skipped)`: itera `session.laps.pick_drivers(...)` → `lap.get_telemetry()` por vuelta (incluye `Distance`, `RelativeDistance`, `DriverAhead`, `DistanceToDriverAhead`, `Status`), descarta vueltas sin `X/Y`, escribe con `pq.ParquetWriter(compression="zstd", compression_level=6)` por lotes de 50 vueltas a `out_path.with_suffix(".parquet.tmp")` y renombra al final.
- `telemetry_reader.py`: `read_lap(path, driver, lap, channels) -> dict[str, list]` con DuckDB `SELECT … FROM read_parquet(?) WHERE driver=? AND lap=? ORDER BY t_ms` y remuestreo a ≤ 2000 puntos por `distance` (interpolación lineal; `gear/drs` por escalón); `read_fastest_laps(path, drivers) -> …`; conexión DuckDB en memoria por proceso (`duckdb.connect()` con `SET threads=2`).

- [ ] **Paso 1: Tests (fallan primero)**

```python
def test_layout_edges_are_offset_by_half_width(ref_lap_fixture) -> None:
    lay = layout_from_reference(ref_lap_fixture, n=500, half_width_m=7.0)
    d = np.hypot(lay.inner_edge[:, 0] - lay.outer_edge[:, 0], lay.inner_edge[:, 1] - lay.outer_edge[:, 1])
    assert np.allclose(d, 14.0, atol=0.5) and 4000 < lay.lap_length_m < 7500

def test_parquet_roundtrip_and_tmp_rename(tmp_path, fake_session_with_two_laps) -> None:
    out = tmp_path / "s.parquet"
    stats = write_session_telemetry(fake_session_with_two_laps, out)
    assert out.exists() and not out.with_suffix(".parquet.tmp").exists() and stats.rows > 0 and stats.has_position
    assert pq.read_schema(out).equals(TELEMETRY_SCHEMA)

def test_read_lap_resamples_and_steps_gear(tmp_path, parquet_fixture) -> None:
    d = read_lap(parquet_fixture, "VER", 12, ["speed", "gear", "distance"])
    assert len(d["distance"]) <= 2000 and set(d["gear"]) <= set(range(0, 9))
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(f1data): geometría del circuito, telemetría completa en Parquet (zstd) y lector DuckDB`.

---

### Tarea 6: Handlers de ingesta, scheduler post-sesión y reintentos

**Archivos:**
- Crear: `app/worker/jobs/fastf1_ingest.py`, `app/worker/jobs/openf1_ingest.py`, `app/worker/jobs/post_session.py`
- Modificar: `app/worker/scheduler.py`, `app/worker/runner.py` (`next_attempt_at` en `ingest_runs` + `max_attempts` por kind), `app/models/ingest.py` (`next_attempt_at`), migración `0006_ingest_backoff`
- Test: `tests/test_fastf1_ingest.py` (con `load_session` parcheado por una sesión falsa construida con DataFrames), `tests/test_post_session.py`

**Interfaces:**
- `async def ingest_fastf1_session(db, run: IngestRun) -> None`: `target="session:{id}"`; carga con `load_session`; en orden: resultados extendidos (upsert `session_results` con `classified_position`, `grid`, `status`, `points`, `headshot_url`, `team_color`, `source="fastf1"` **sin pisar** filas de Jolpica salvo campos nuevos), `laps` (extract + classify + fill + gaps si 2018–2022), `stints`, `pit_stops`, `race_control_messages`, `weather_samples`, `track_status_changes`, `circuit_layouts`/`circuit_markers` (si no existen para circuito+año), Parquet (`/data/telemetry/{year}/{session_id}.parquet`) + `telemetry_files`; marca `sessions.ingested_at`, `ingest_status='complete'`; borra el caché de FastF1 de esa sesión; encola `openf1_session` si `year >= 2023` y `replay_build` si `type in (R, S)` (Fase 4 registra el handler).
- `SessionDataUnavailable` → el runner deja `queued` con `next_attempt_at = now + 2h * attempts` hasta `max_attempts=6`.
- `async def ingest_openf1_session(db, run)`: resuelve `session_key`, guarda en `sessions.openf1_session_key`; `intervals` → actualiza `laps.gap_to_leader_ms/interval_ms`; `overtakes`; `team_radio`; `pit` → `pit_stops.stop_ms/lane_ms`; `position` → `laps.position` cuando FastF1 no la trae (FP/Q).
- `job_enqueue_finished_sessions` (cada 10 min): sesiones con `starts_at + duration_min + 45 min <= now`, `ingest_status='none'`, `season_year >= 2018` → `enqueue("fastf1_session", f"session:{id}")`.
- `python -m app.worker backfill --from 2018 --to 2026 --types R,Q,S,SQ,FP1,FP2,FP3 [--dry-run]`: encola en orden cronológico inverso (lo más reciente primero) todas las sesiones sin ingerir; retomable porque solo encola lo que falta.

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_ingest_writes_all_tables_and_marks_session(db, fake_session, tmp_data_dir, monkeypatch) -> None:
    monkeypatch.setattr("app.worker.jobs.fastf1_ingest.load_session", lambda *a, **k: fake_session)
    s = await make_session(db, year=2024, type="R")
    run = IngestRun(kind="fastf1_session", target=f"session:{s.id}")
    await ingest_fastf1_session(db, run)
    assert await db.scalar(select(func.count()).select_from(Lap).where(Lap.session_id == s.id)) > 0
    assert (await db.get(Session, s.id)).ingest_status == "complete"
    assert (tmp_data_dir / "telemetry" / "2024" / f"{s.id}.parquet").exists()
    kinds = set((await db.execute(select(IngestRun.kind))).scalars())
    assert {"openf1_session", "replay_build"} <= kinds

async def test_unavailable_data_requeues_with_backoff(db, monkeypatch) -> None:
    def boom(*a, **k): raise SessionDataUnavailable("todavía no hay datos")
    monkeypatch.setattr("app.worker.jobs.fastf1_ingest.load_session", boom)
    s = await make_session(db, year=2026, type="R")
    rid = await enqueue(db, "fastf1_session", f"session:{s.id}")
    await run_queue_once(db)
    run = await db.get(IngestRun, rid)
    assert run.status == "queued" and run.attempts == 1 and run.next_attempt_at is not None
    assert await run_queue_once(db) == 0        # no se vuelve a tomar antes de next_attempt_at

async def test_enqueue_finished_sessions_only_after_grace(db) -> None: ...
```

- [ ] **Paso 2: Implementar, probar con una sesión real y commit**

```bash
cd apps/api && uv run python -m app.worker ingest --year 2025 --round 1 --type Q && uv run python -m app.worker ingest --year 2025 --round 1 --type R
```

Expected: ambas sesiones `complete`; `laps` ≈ 20 × vueltas; Parquet de la carrera ≈ 60–120 MB; RAM pico < 4 GB (medir con `Get-Process python | Select PeakWorkingSet64`). Anotar tamaño real en `infra/easypanel.md` (estimación §4.5). Commit: `feat(worker): ingesta FastF1/OpenF1 post-sesión con reintentos, scheduler y backfill retomable`.

---

### Tarea 7: Endpoints de análisis

**Archivos:**
- Crear: `app/routers/analysis.py`, `app/schemas/analysis.py`
- Test: `tests/test_analysis_endpoints.py`

**Interfaces (todos `public_cache(300)` y paginados donde aplica):**
- `GET /api/sessions/{id}/laps?driver=&page=&limit=200` → filas de `laps` (con `driver.code`), `meta: {base_pace_ms, total_laps}`.
- `GET /api/sessions/{id}/stints`, `/pits`, `/race-control?page=`, `/weather`, `/intervals` (gap/intervalo por vuelta y piloto, formato compacto `{laps: [1..n], drivers: {VER: {gap: [...], interval: [...]}}}`), `/overtakes`, `/team-radio`, `/track-status`.
- `GET /api/sessions/{id}/analysis/summary` → `{fastest: {driver, lap, time_ms}, best_sectors: {s1: {driver, ms}, s2, s3}, theoretical_ms, per_driver: [{driver, best_lap_ms, best_s1, best_s2, best_s3, pb_sectors, speed_trap_max}], deleted_laps: [...], long_runs (solo FP): [{driver, compound, laps, avg_ms, deg_ms_per_lap}]}` usando `f1data.lib.sectors`.
- `GET /api/sessions/{id}/positions` → `{laps: [...], drivers: {VER: [pos por vuelta]}}`.
- `GET /api/sessions/{id}/telemetry?driver=VER&lap=12&channels=speed,throttle,brake,gear,rpm,drs,x,y,distance` (404 `telemetry_unavailable` si no hay Parquet; 422 si `lap` no existe). Dos pilotos: `?driver=VER&lap=12&driver2=NOR&lap2=15` → ambos + `delta_ms` por distancia (interpolando el tiempo acumulado del segundo sobre la distancia del primero).
- `GET /api/circuits/{id}/layout?year=` → `circuit_layouts` + `circuit_markers`.

- [ ] **Paso 1: Tests, implementación, regenerar tipos, commit**

Commit: `feat(api): endpoints de análisis de sesión, telemetría con delta y layout del circuito`.

---

### Tarea 8: Web — Página de análisis de sesión

**Archivos:**
- Crear: `src/features/analysis/AnalysisPage.tsx` (`/sesiones/:id/analisis`, tabs lazy: Vueltas · Posiciones · Gaps · Estrategia · Sectores · Velocidad · Borradas · Adelantamientos (2023+) · Radio (2023+) · Telemetría · Long runs (FP)), `src/features/analysis/charts/LapChart.tsx` (uPlot: tiempo por vuelta por piloto; toggles "ocultar pits/outliers", "media móvil 3", selección de pilotos con chips de color; en móvil leyenda colapsable y pan/zoom táctil con el plugin `touchZoom` de uPlot), `PositionChart.tsx`, `GapChart.tsx`, `StrategySvg.tsx` (barras de stints por piloto con color de compuesto y marcas de pit; scroll horizontal en móvil con cabecera fija), `SectorsTable.tsx` (PB verde, SB púrpura, vuelta teórica), `SpeedTrapTable.tsx`, `DeletedLapsList.tsx`, `OvertakesList.tsx`, `TeamRadioList.tsx` (`<audio controls preload="none">`), `LongRunsTable.tsx`
- Crear: `src/features/analysis/telemetry/TelemetryComparator.tsx` (selección piloto+vuelta ×2 con `DriverPicker` + select de vuelta (mejor vuelta por defecto); canales apilados en uPlot sincronizados por cursor: velocidad, acelerador, freno, marcha, RPM, DRS; panel de delta; `TrackMap.tsx` en Canvas 2D con la polilínea, curvas numeradas y marcador que sigue el cursor; cálculo del delta y remuestreo en `src/workers/telemetry.worker.ts`)
- Modificar: `src/features/event/SessionTabs.tsx` (habilitar botón "Análisis" cuando `ingested_at` no es nulo), `src/i18n/es.ts`, `src/routes.tsx`
- Test: `tests/telemetryWorker.test.ts` (delta correcto con dos series sintéticas), `tests/StrategySvg.test.tsx`

- [ ] **Paso 1: Implementar, verificar en navegador, commit**

Verificación en navegador interno con Bahréin 2025 Q y R ingeridas (T6), móvil y desktop, screenshots por tab:
1. Vueltas: 20 pilotos, ocultar pits elimina picos, media móvil suaviza; pan táctil funciona.
2. Estrategia: barras alineadas, colores de compuesto correctos, scroll horizontal interno.
3. Sectores: PB/SB y vuelta teórica < mejor vuelta real.
4. Telemetría: VER vs LEC mejores vueltas → 6 canales sincronizados, delta y mapa con curvas; mover el cursor mueve el marcador del mapa; en móvil el mapa va arriba y los canales apilados debajo, sin scroll horizontal.
5. `read_network_requests`: `/telemetry` < 300 ms y respuesta < 400 kB; consola sin errores; `performance`: scroll fluido con 20 series.

Commit: `feat(web): página de análisis de sesión con charts, estrategia, sectores y comparador de telemetría`.

---

### Tarea 9: Backfill 2018→hoy y operación

**Archivos:**
- Modificar: `infra/easypanel.md` (worker 4 GB, volúmenes `telemetry` 20 GB y `fastf1-cache` 20 GB con limpieza), `apps/web/src/features/admin/AdminPage.tsx` (tab Ingesta: progreso del backfill `done/total` por año, botón "Re-ingestar sesión")
- Crear: `scripts/upload-telemetry.ps1` (si se genera local: `scp`/`rsync` del Parquet al volumen, D2 del plan maestro)

- [ ] **Paso 1: Ejecutar `backfill --from 2026 --to 2018` (o local, según RAM del VPS) y monitorear**

Expected: la cola avanza sola, una sesión a la vez; una sesión fallida 6 veces queda `failed` con error visible en admin; el backfill se puede cortar y retomar. Medir y anotar: tiempo medio por carrera, tamaño de Parquet por temporada, RAM pico. Commit: `docs(infra): operación del backfill y telemetría`.

---

## Criterio de "listo" de la Fase 3

- [ ] Una carrera y una qualy reales se ingieren solas ~45 min después de terminar (verificado en un fin de semana de 2026 o simulado con `starts_at` en el pasado).
- [ ] Backfill 2018→hoy completo o en curso y retomable; RAM del worker < 4 GB.
- [ ] Test de contrato de FastF1 verde y programado en CI.
- [ ] Página de análisis verificada en navegador interno en móvil y desktop con todas las tabs sobre una sesión real.
- [ ] Correcciones §4.4 cubiertas por tests (`test_laps`, `test_gaps`, `test_parquet`).
