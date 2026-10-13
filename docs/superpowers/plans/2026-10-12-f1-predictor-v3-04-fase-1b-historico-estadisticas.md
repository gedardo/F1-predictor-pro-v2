# Fase 1b — Histórico 1950→hoy + estadísticas: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Cargar el histórico completo de Jolpica (dumps CSV, 1950→hoy) en las mismas tablas de referencia/resultados de la Fase 1a, y construir las páginas de Pilotos, Equipos, Circuitos, Récords, Comparador de compañeros y Archivo de temporadas.

**Arquitectura:** Un cargador por lotes (`python -m app.worker load-dump`) descarga el dump, lo mete en tablas `staging_*` con `COPY`, y lo transforma con SQL idempotente a `circuits/drivers/teams/season_entries/events/sessions/session_results/driver_standings/constructor_standings`. Regla de propiedad: **el dump carga años `< año en curso`; la API de Jolpica (Fase 1a) es dueña del año en curso.** Las estadísticas se calculan por query con índices (sin vistas materializadas); un par de totales por piloto se cachean 1 h en memoria del proceso.

**Tech Stack:** asyncpg `copy_records_to_table`, SQL puro para las transformaciones, SQLAlchemy para lecturas, `zipfile`/`csv` stdlib; web: TanStack Query, tablas responsive, uPlot para series por temporada.

**Spec:** `propuesta.md` §2.1, §4.1 (fila "Histórico 1950→hoy"), §4.5, §7 (Estadísticas), §10 fila "1b". **Plan maestro:** §1 D13, §3.2 (rendimiento), §3.3.

## Restricciones globales

- Dumps **gratuitos**, uso no comercial, disponibles 14 días después de subidos; sin autenticación. No bajar el histórico por API (miles de pedidos a 500/h).
- Identidades: `drivers.ref`, `teams.ref`, `circuits.ref` = `reference` de Jolpica (coinciden con los `driverId/constructorId/circuitId` de la API). Pilotos antiguos sin `code` → `display_code`.
- Puntos como `Numeric` (hubo medios puntos, p. ej. 1984 Mónaco).
- Nunca sobreescribir el año en curso desde el dump.

## Foco de revisión

1. **Pilotos con el mismo apellido** (Schumacher Michael/Ralf/Mick, Verstappen Jos/Max): se distinguen por `ref`; el buscador muestra nombre completo + años de actividad. Test T5.
2. **Temporadas con sistemas de puntos distintos y "mejores N resultados"** (hasta 1990): no recalcular standings a partir de resultados; usar los standings del dump. Test T3 (`1988 Prost tiene más puntos brutos que Senna pero el campeón es Senna`).
3. **Carreras compartidas / pilotos con varios autos en los 50** (`session_entries` con el mismo piloto dos veces): la restricción `UNIQUE(session_id, driver_id)` se relaja a `UNIQUE(session_id, driver_id, car_number)` en esta fase. Test T2.
4. **Dump más nuevo que la DB** (re-ejecución meses después): la carga es idempotente y solo actualiza años cerrados; `sync_state['jolpica_dump']` guarda `uploaded_at`. Test T3.
5. **Comparador con compañeros que cambiaron de equipo a mitad de año:** se compara solo en las carreras en las que compartieron equipo. Test T6.

---

### Tarea 1: Descarga e inspección del dump

**Archivos:**
- Crear: `app/services/jolpica_dumps.py`, `scripts/fetch-jolpica-dump.ps1`
- Test: `tests/test_jolpica_dumps.py` (con un zip sintético pequeño)

**Interfaces:**
- `async def latest_dump_info(http) -> DumpInfo(url: str, uploaded_at: datetime, size: int)` leyendo el endpoint "Dumps Overview" documentado en `docs/endpoints/data/dumps.md` del repo de Jolpica (campo `uploaded_at`). La URL exacta del endpoint se toma de ese documento al ejecutar la tarea y se fija en `DUMPS_OVERVIEW_URL` en `config.py` (`jolpica_dumps_url`).
- `async def download_dump(http, info, dest_dir: Path) -> Path` (streaming a `dest_dir/jolpica-<uploaded_at>.zip`, verifica tamaño).
- `def inspect_dump(zip_path) -> dict[str, list[str]]` (nombre de CSV → cabecera).

- [ ] **Paso 1: Leer la documentación del endpoint de dumps y fijar la URL**

Abrir `https://github.com/jolpica/jolpica-f1/blob/main/docs/endpoints/data/dumps.md`, copiar la URL del overview y la del archivo de la capa gratuita. Guardarlas en `.env.example` (`JOLPICA_DUMPS_URL=`) y en `infra/easypanel.md`.

- [ ] **Paso 2: Test de inspección con zip sintético**

```python
import csv, io, zipfile
from pathlib import Path
from app.services.jolpica_dumps import inspect_dump

def test_inspect_dump_lists_headers(tmp_path: Path) -> None:
    z = tmp_path / "d.zip"
    with zipfile.ZipFile(z, "w") as zf:
        buf = io.StringIO(); csv.writer(buf).writerows([["id", "reference", "name"], [1, "monza", "Monza"]])
        zf.writestr("circuit.csv", buf.getvalue())
    assert inspect_dump(z) == {"circuit.csv": ["id", "reference", "name"]}
```

- [ ] **Paso 3: Implementar, bajar el dump real y documentar las cabeceras**

```bash
cd apps/api && uv run python -c "from app.services.jolpica_dumps import *; import asyncio, httpx; print(asyncio.run(main_cli()))" --download --dest ./data/dumps
uv run python -c "from app.services.jolpica_dumps import inspect_dump; import json; print(json.dumps(inspect_dump('data/dumps/latest.zip'), indent=1))" > docs/jolpica-dump-headers.json
```

Expected: el JSON lista los CSV del modelo de Jolpica. El modelo documentado en `jolpica/formula_one/models/` es: `circuit`, `driver`, `team`, `season`, `round`, `session`, `round_entry`, `team_driver`, `session_entry`, `lap`, `pit_stop`, `point_scheme`, `penalty`, `driver_championship`, `team_championship`, `championship_system`, `championship_adjustment`. Si alguna cabecera difiere de `COLUMN_MAP` (T2), ajustar el mapa **antes** de seguir y commitear `docs/jolpica-dump-headers.json` como contrato.

Commit: `feat(api): descarga e inspección de dumps de Jolpica`.

---

### Tarea 2: Staging con COPY y mapa de columnas

**Archivos:**
- Crear: `app/services/jolpica_dump_load.py`, `alembic/versions/0004_history.py` (tablas `staging_*` UNLOGGED, columna `car_number` en `session_results` y nueva unicidad, columna `fastest_lap_ms`, `drivers.active_from/active_to` calculados)
- Test: `tests/test_dump_load.py`

**Interfaces:**
- `COLUMN_MAP: dict[str, list[str]]` por CSV (columnas que se cargan), p. ej. `"driver.csv": ["id", "reference", "forename", "surname", "abbreviation", "nationality", "permanent_car_number", "date_of_birth", "wikipedia"]`, `"team.csv": ["id", "reference", "name", "nationality", "wikipedia"]`, `"circuit.csv": ["id", "reference", "name", "locality", "country", "latitude", "longitude"]`, `"season.csv": ["id", "year"]`, `"round.csv": ["id", "season_id", "number", "name", "date", "circuit_id", "is_cancelled"]`, `"session.csv": ["id", "round_id", "number", "type", "date", "time", "is_cancelled"]`, `"team_driver.csv": ["id", "team_id", "driver_id", "season_id", "role"]`, `"round_entry.csv": ["id", "round_id", "team_driver_id", "car_number"]`, `"session_entry.csv": ["id", "session_id", "round_entry_id", "position", "is_classified", "status", "points", "grid", "time", "fastest_lap_rank", "laps_completed"]`, `"driver_championship.csv": ["id", "session_id", "year", "round_number", "driver_id", "position", "points", "win_count"]`, `"team_championship.csv": ["id", "session_id", "year", "round_number", "team_id", "position", "points", "win_count"]`.
- `async def load_staging(conn: asyncpg.Connection, zip_path: Path) -> dict[str, int]` (`TRUNCATE staging_x; COPY` con `copy_records_to_table`, tipos como `text` y casteos en la transformación).
- `SESSION_TYPE_MAP = {"R": "R", "SR": "S", "Q": "Q", "Q1": "Q", "Q2": "Q", "Q3": "Q", "SQ1": "SQ", "SQ2": "SQ", "SQ3": "SQ", "FP1": "FP1", "FP2": "FP2", "FP3": "FP3"}` (las qualys por fases se colapsan a una sesión `Q`/`SQ` tomando la mejor posición final de la última fase disputada).

- [ ] **Paso 1: Test con zip sintético (2 pilotos, 1 carrera)**

```python
async def test_load_staging_counts(tmp_path, engine) -> None:
    z = make_mini_dump(tmp_path)   # helper del test: driver.csv con 2 filas, round.csv 1, session.csv 2 (Q y R), session_entry.csv 4
    async with engine.connect() as conn:
        raw = await conn.get_raw_connection()
        counts = await load_staging(raw.driver_connection, z)
    assert counts["staging_driver"] == 2 and counts["staging_session_entry"] == 4
```

- [ ] **Paso 2: Implementar y commit**

`copy_records_to_table("staging_driver", records=rows, columns=COLUMN_MAP["driver.csv"])` leyendo el CSV con `csv.DictReader` desde el zip sin descomprimir a disco. Commit: `feat(api): staging del dump de Jolpica con COPY`.

---

### Tarea 3: Transformación idempotente staging → tablas de dominio

**Archivos:**
- Crear: `app/services/jolpica_dump_transform.sql` (archivo SQL con bloques nombrados) y `app/services/jolpica_dump_transform.py` (ejecuta los bloques en orden dentro de una transacción, parametrizado con `:current_year`)
- Modificar: `app/worker/__main__.py` (`load-dump --path X [--current-year 2026]`)
- Test: `tests/test_dump_transform.py` (mini dump + aserciones) y `tests/test_dump_transform_real.py` marcado `network`/`slow` sobre el dump real.

**Interfaces:**
- `async def transform(db, current_year: int) -> TransformReport(circuits, drivers, teams, events, sessions, results, standings_rounds)`.
- Bloques SQL (orden): `circuits`, `drivers`, `teams`, `seasons`, `events` (de `round` con `season.year < :current_year`), `sessions` (colapsando fases), `season_entries` (de `team_driver`), `session_results` (de `session_entry` ⨝ `round_entry` ⨝ `team_driver`; `position_text` = `position` o `R/D/W/N` según `is_classified` y `status`; `fastest_lap_ms` del `lap` con `is_entry_fastest_lap`), `driver_standings` y `constructor_standings` (de `driver_championship`/`team_championship`, una fila por ronda).
- Cada bloque usa `INSERT … SELECT … ON CONFLICT (…) DO UPDATE` y excluye `season_year >= :current_year`.

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_transform_mini_dump_idempotent(db, mini_dump_loaded) -> None:
    r1 = await transform(db, current_year=2026); r2 = await transform(db, current_year=2026)
    assert r1.results == r2.results == 2 and r1.events == 1
    assert await db.scalar(select(func.count()).select_from(SessionResult)) == 2

async def test_transform_skips_current_year(db, mini_dump_loaded_with_2026_round) -> None:
    await transform(db, current_year=2026)
    assert await db.scalar(select(func.count()).select_from(Event).where(Event.season_year == 2026)) == 0


@pytest.mark.slow
async def test_real_dump_known_totals(db, real_dump_loaded) -> None:
    await transform(db, current_year=2026)
    async def wins(ref): return await db.scalar(text("""SELECT count(*) FROM session_results sr JOIN sessions s ON s.id=sr.session_id JOIN drivers d ON d.id=sr.driver_id
                                                       WHERE d.ref=:r AND s.type='R' AND sr.position=1"""), {"r": ref})
    assert await wins("michael_schumacher") == 91
    assert await wins("senna") == 41
    assert await wins("fangio") == 24
    async def titles(ref): return await db.scalar(text("""SELECT count(*) FROM driver_standings ds JOIN drivers d ON d.id=ds.driver_id
        WHERE d.ref=:r AND ds.position=1 AND ds.round = (SELECT max(round) FROM driver_standings x WHERE x.season_year=ds.season_year)"""), {"r": ref})
    assert await titles("michael_schumacher") == 7 and await titles("fangio") == 5 and await titles("prost") == 4
    # 1988: Prost suma más puntos brutos que Senna, pero el campeón (standings del dump) es Senna
    champ_1988 = await db.scalar(text("""SELECT d.ref FROM driver_standings ds JOIN drivers d ON d.id=ds.driver_id WHERE ds.season_year=1988 AND ds.position=1
                                         AND ds.round=(SELECT max(round) FROM driver_standings WHERE season_year=1988)"""))
    assert champ_1988 == "senna"
```

- [ ] **Paso 2: SQL (extracto del bloque `session_results`)**

```sql
-- name: session_results
INSERT INTO session_results (session_id, driver_id, team_id, car_number, position, position_text, grid, status, points, time_ms, laps, fastest_lap_rank, fastest_lap_ms, source)
SELECT s.id, d.id, t.id, re.car_number::int,
       CASE WHEN se.is_classified::boolean THEN se.position::int END,
       CASE WHEN se.is_classified::boolean THEN se.position
            WHEN se.status ILIKE 'disqualified%' THEN 'D'
            WHEN se.status ILIKE 'did not start%' OR se.status ILIKE 'withdr%' THEN 'W'
            ELSE 'R' END,
       NULLIF(se.grid, '')::int, se.status, COALESCE(NULLIF(se.points, '')::numeric, 0),
       CASE WHEN se.time ~ '^\d{2}:\d{2}:\d{2}' THEN (EXTRACT(EPOCH FROM se.time::interval) * 1000)::bigint END,
       NULLIF(se.laps_completed, '')::int, NULLIF(se.fastest_lap_rank, '')::int,
       (SELECT (EXTRACT(EPOCH FROM l.time::interval) * 1000)::int FROM staging_lap l WHERE l.session_entry_id = se.id AND l.is_entry_fastest_lap::boolean LIMIT 1),
       'jolpica_dump'
FROM staging_session_entry se
JOIN staging_session ss ON ss.id = se.session_id
JOIN staging_round sr ON sr.id = ss.round_id
JOIN staging_season sea ON sea.id = sr.season_id
JOIN staging_round_entry re ON re.id = se.round_entry_id
JOIN staging_team_driver td ON td.id = re.team_driver_id
JOIN drivers d ON d.ref = (SELECT reference FROM staging_driver WHERE id = td.driver_id)
JOIN teams t ON t.ref = (SELECT reference FROM staging_team WHERE id = td.team_id)
JOIN events e ON e.season_year = sea.year::int AND e.round = sr.number::int
JOIN sessions s ON s.event_id = e.id AND s.type = :session_type_expr
WHERE sea.year::int < :current_year AND ss.type IN ('R','SR')
ON CONFLICT (session_id, driver_id, car_number) DO UPDATE SET
  team_id = EXCLUDED.team_id, position = EXCLUDED.position, position_text = EXCLUDED.position_text, grid = EXCLUDED.grid,
  status = EXCLUDED.status, points = EXCLUDED.points, time_ms = EXCLUDED.time_ms, laps = EXCLUDED.laps,
  fastest_lap_rank = EXCLUDED.fastest_lap_rank, fastest_lap_ms = EXCLUDED.fastest_lap_ms;
```

(El bloque de qualy hace lo análogo con `ss.type IN ('Q','Q1','Q2','Q3','SQ1','SQ2','SQ3')` agrupando por `round_entry` y tomando la mejor fase; `q1_ms/q2_ms/q3_ms` desde el `time` de cada fase.)

- [ ] **Paso 3: Correr contra el dump real y commit**

```bash
cd apps/api && uv run python -m app.worker load-dump --path data/dumps/latest.zip --current-year 2026
```

Expected: `TransformReport(events≈1150, results≈27000, standings_rounds≈1150)` y el test `slow` verde. Guardar `sync_state['jolpica_dump'] = {uploaded_at, loaded_at}`. Commit: `feat(worker): transformación idempotente del dump histórico 1950→hoy`.

---

### Tarea 4: Endpoints de estadísticas

**Archivos:**
- Crear: `app/routers/stats.py`, `app/services/stats.py`, `app/schemas/stats.py`
- Test: `tests/test_stats.py` (sobre mini dump + fixtures 2025) y aserciones `slow` sobre el real

**Interfaces:**
- `GET /api/drivers/{id}` → `DriverDetailOut(driver, seasons: [{year, team, number, points, position, wins, podiums}], totals: {starts, wins, podiums, poles, fastest_laps, points, titles, first_race: {year, event}, last_race})`.
- `GET /api/drivers/{id}/results?year=` → resultados por evento del año.
- `GET /api/teams/{id}` → `TeamDetailOut(team, seasons: [{year, drivers, points, position, wins}], totals: {wins, podiums, poles, titles, seasons})`.
- `GET /api/circuits/{id}` → `CircuitDetailOut(circuit, events: [{year, event_id, winner, pole, fastest_lap_ms}], records: {most_wins_driver, most_wins_team, lap_record: {driver, year, ms}})`.
- `GET /api/stats/records?metric=wins|poles|podiums|titles|starts|points&entity=drivers|teams&limit=25`.
- `GET /api/stats/search?q=` → `{drivers: [{id, name, code, active_from, active_to}], teams: [...], circuits: [...]}` (ILIKE sobre nombre con `unaccent`; índice `pg_trgm`).
- `GET /api/seasons/{year}/archive` → rondas con ganador, pole, VR y campeones.
- `GET /api/drivers/compare?a={id}&b={id}&year=` → solo carreras donde compartieron equipo: `{quali: {a_ahead, b_ahead}, race: {a_ahead, b_ahead}, points: {a, b}, head_to_head: [{event, a_grid, b_grid, a_pos, b_pos}]}`.
- Cache: `public_cache(3600)` en todo salvo `search` (300).

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_driver_totals_and_records(client, db, real_or_mini_history) -> None:
    sid = await db.scalar(select(Driver.id).where(Driver.ref == "michael_schumacher"))
    r = await client.get(f"/api/drivers/{sid}")
    assert r.status_code == 200 and r.json()["totals"]["wins"] == 91 and r.json()["totals"]["titles"] == 7
    rec = (await client.get("/api/stats/records", params={"metric": "poles", "entity": "drivers", "limit": 3})).json()
    assert rec["rows"][0]["value"] >= 68

async def test_search_disambiguates_schumachers(client, db, real_or_mini_history) -> None:
    r = (await client.get("/api/stats/search", params={"q": "schumacher"})).json()
    names = [d["name"] for d in r["drivers"]]
    assert any("Michael" in n for n in names) and any("Ralf" in n for n in names) and all("active_from" in d for d in r["drivers"])

async def test_compare_only_shared_team_races(client, db, history_with_mid_season_swap) -> None: ...
```

- [ ] **Paso 2: Implementar (queries clave)**

Totales por piloto (una sola consulta):

```sql
SELECT count(*) FILTER (WHERE s.type='R') AS starts,
       count(*) FILTER (WHERE s.type='R' AND sr.position=1) AS wins,
       count(*) FILTER (WHERE s.type='R' AND sr.position<=3) AS podiums,
       count(*) FILTER (WHERE s.type='Q' AND sr.position=1) AS poles,
       count(*) FILTER (WHERE s.type='R' AND sr.fastest_lap_rank=1) AS fastest_laps,
       coalesce(sum(sr.points) FILTER (WHERE s.type IN ('R','S')),0) AS points
FROM session_results sr JOIN sessions s ON s.id=sr.session_id WHERE sr.driver_id=:id;
```

Índices nuevos en `0004_history`: `session_results(driver_id, session_id)`, `session_results(session_id, position)`, `sessions(type, event_id)`, `driver_standings(driver_id, season_year)`, `pg_trgm` + `unaccent` con índice GIN sobre `lower(unaccent(first_name||' '||last_name))`.

Commit: `feat(api): endpoints de estadísticas, récords, búsqueda, archivo y comparador`.

---

### Tarea 5: Web — Estadísticas, pilotos, equipos, circuitos, archivo

**Archivos:**
- Crear: `src/features/stats/StatsHubPage.tsx` (`/estadisticas`: buscador con debounce 250 ms y resultados agrupados; tabs de récords con selector de métrica), `src/features/stats/DriverPage.tsx` (`/pilotos/:id`: cabecera con bandera/nacionalidad, totales en tarjetas 2×3 en móvil, tabla por temporada → tarjetas en móvil, gráfico uPlot de puntos por temporada), `TeamPage.tsx` (`/equipos/:id`), `CircuitPage.tsx` (`/circuitos/:id`), `SeasonArchivePage.tsx` (`/temporadas/:year` con selector de año 1950→hoy), `ComparePage.tsx` (`/comparar?a=&b=`: dos `DriverPicker` de la Fase 2 reutilizados con búsqueda global, barras head-to-head)
- Modificar: `src/routes.tsx`, `src/i18n/es.ts`, `src/components/layout/navItems.ts` (habilitar "Estadísticas" en `/mas` y Navbar)
- Test: `tests/StatsSearch.test.tsx` (debounce y agrupación), `tests/DriverTotals.test.tsx`

- [ ] **Paso 1: Implementar, verificar en navegador, commit**

Verificación en navegador interno (móvil y desktop, screenshots):
1. `/estadisticas`: buscar "schum" → aparecen Michael, Ralf y Mick con años; abrir Michael → totales 91/68/7.
2. Récords: métrica "Títulos" → Schumacher y Hamilton 7, Fangio 5.
3. `/circuitos/:monza` → lista de ganadores por año y récord de vuelta.
4. `/temporadas/1988` → 16 rondas, campeón Senna.
5. `/comparar?a=&b=` → dos compañeros de 2025 → barras de qualy y carrera.
6. Sin scroll horizontal; tablas convertidas a tarjetas en móvil; consola sin errores; `cache-control: public, max-age=3600` en `/api/drivers/*`.

Commit: `feat(web): estadísticas, pilotos, equipos, circuitos, archivo y comparador`.

---

### Tarea 6: Job mensual de actualización del dump

**Archivos:**
- Modificar: `app/worker/scheduler.py` (job `jolpica_dump_refresh` el día 1 de cada mes 05:00 UTC: compara `uploaded_at` con `sync_state`, descarga a `/data/dumps`, carga, borra el zip anterior), `infra/easypanel.md` (volumen `dumps` 2 GB en el worker)
- Test: `tests/test_dump_refresh.py` (no recarga si `uploaded_at` no cambió)

- [ ] **Paso 1: Implementar, probar, commit**

Commit: `feat(worker): actualización mensual automática del histórico`.

---

## Criterio de "listo" de la Fase 1b

- [ ] `load-dump` carga 1950→2025 en < 15 min en la PC local y es idempotente; el año en curso no se toca.
- [ ] Los totales de la muestra (Schumacher 91/68/7, Senna 41/65/3, Fangio 24/5, Prost 51/4, campeón 1988 Senna, Ferrari ≥ 16 títulos de constructores) coinciden.
- [ ] Páginas de Estadísticas verificadas en navegador interno en móvil y desktop.
- [ ] Job mensual configurado y volumen `dumps` montado en Easypanel.
