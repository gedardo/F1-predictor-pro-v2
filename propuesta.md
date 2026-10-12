# F1 Predictor Pro v3 — Propuesta de desarrollo

> Rehacer la app como plataforma completa de F1. Toma como base las páginas y la lógica de juego de `F1-predictor-pro-v2` y el motor de datos de `f1-race-replay`, sobre Postgres self-hosted en Easypanel. **Proyecto de fans, sin fines comerciales.**

## 1. Punto de partida

### F1-predictor-pro-v2 (esta app)
- SPA en React 19 + Vite + TS con Supabase (auth + Postgres + 1 Edge Function).
- **Se reutiliza (UI y reglas):** Home, Calendario, Predicciones, Mi Equipo (fantasy), Standings, Leaderboard de usuarios, Reglas, Perfil, juego "Adiviná el piloto" (componentes `game/*`), panel Admin y las reglas de puntuación de `constants.ts` (`SCORING_RULES`).
- **Se descarta:** el cliente Supabase, `f1-api-node` (no funciona en el browser), Firebase, las noticias generadas con Gemini (son inventadas), los datos mock y hardcodeados de 2025, el admin por email y toda la lógica de puntos que corre en el cliente.
- El proyecto de Supabase ya no existe, así que no hay usuarios ni datos que migrar: se arranca de cero.

### f1-race-replay (Python, ~16.5k LOC, licencia MIT)
App de escritorio (Arcade + PySide6) basada en **FastF1**. Lo valioso no es la UI sino la capa de datos, que **está repartida en dos lugares**: `src/f1_data.py` y `src/interfaces/race_replay.py`. Portar solo el primero pierde los tiempos por vuelta oficiales, los gaps y las heurísticas de pits.

| Módulo | Qué aporta | Reutilización |
|---|---|---|
| `src/f1_data.py` | Carga sesiones (R, S, Q, SQ, FP), arma frames de 25 FPS con x/y, velocidad, marcha, acelerador, freno, DRS, neumático, posición y vuelta por piloto. Además clima, track status, mensajes de race control, simulación del Safety Car, colores por piloto, rotación del circuito, standings previos y vuelta a vuelta, resultados de qualy y práctica, telemetría de la vuelta más rápida por piloto en Q1/Q2/Q3 y prácticas (con zonas de DRS) y calendario. | **Portar** a un paquete Python sin GUI. Sacar `sys.argv`, `print` y `pickle`, y que la salida vaya a DB y a archivos. Corregir los bugs de §4.4. |
| `src/interfaces/race_replay.py` | Tiempos por vuelta oficiales (sectores, in/out laps, vueltas reconstruidas, DNF, gap final), **gap al líder e intervalo oficiales**, detección de pits y outliers, ritmo base, relleno de la vida del neumático, rangos de vueltas con SC/VSC/bandera roja y progreso en pista (KD-tree sobre la línea de referencia). | **Portar la lógica**, no la UI. Los gaps salen de `fastf1._api._extended_timing_data`, una **API privada**: fijar la versión de FastF1 y cubrirla con un test de contrato. Desde 2023 usar `intervals` de OpenF1, que es pública. |
| `src/ui_components.py` (partes) | Bordes de la pista a partir de una vuelta de referencia, zonas de DRS, eventos de carrera (DNF, banderas) y cambios en el campeonato. | **Portar** esas funciones al worker. Descartar los gaps del leaderboard (asumen 200 km/h fijos). |
| `src/lib/{sectors,tyres,time}.py` | Mejores sectores, vuelta teórica, colores PB/SB, helpers de tiempos y neumáticos (con tests). | **Copiar tal cual** junto con sus tests. |
| `bayesian_tyre_model.py` + `tyre_degradation_integration.py` | Salud del neumático (%), degradación por compuesto y predicción de la próxima vuelta con IC 95%. Usa solo numpy y scipy: es un ajuste hacia valores previos más un filtro de Kalman, no PyMC. | Fase 6. Portarlo es barato, pero hay que corregirlo (§4.4) y mostrarlo como **estimado**. |
| `src/insights/*` (PySide6) | Lap time chart, sector times, tyre strategy, track position, race control feed, driver telemetry. | **Especificación funcional** de los componentes React (no se porta código). Sus cálculos (umbral de pit, PB/SB, media móvil de 3 vueltas, promedios por stint, reconstrucción de gaps) pasan al backend. |
| `telemetry.md` (formato del stream) | Contrato JSON de cada frame. | **Base del protocolo** común para replay y en vivo (§4.3). |

MIT obliga a conservar el aviso de copyright: agregar `THIRD_PARTY_NOTICES.md` con la atribución a Tom Shaw (upstream `IAmTomShaw/f1-race-replay`). El fork no tiene archivo `LICENSE`, solo la mención en el README.

## 2. Objetivo de producto

1. **Datos y estadísticas completos:** temporadas 1950→hoy, pilotos, equipos, circuitos, resultados, standings, récords y comparativas.
2. **Análisis de cada sesión** (2018+): vueltas, sectores, speed traps, vueltas borradas, estrategia de neumáticos, pits, posiciones por vuelta, gaps oficiales, race control, clima y comparador de telemetría. Desde 2023, además, adelantamientos y radio.
3. **Race Replay web:** el replay de f1-race-replay en el browser, con mapa del circuito, timing tower, controles de reproducción y Safety Car.
4. **En vivo:** misma pantalla que el replay, alimentada en tiempo real durante la sesión.
5. **Juego:** predicciones, fantasy team, ligas privadas, leaderboards y "Adiviná el piloto", todo validado en el servidor.

## 3. Arquitectura recomendada

```
                    Cloudflare (proxy + cache de /replay/*)
                                     │
                       web (nginx, un solo origen)
          React SPA + PWA · /replay/* desde volumen · proxy de /api
                                     │
                              api (FastAPI)
                       REST /api · WebSocket /api/live
                         │                      │
                   Postgres 17            Redis 7 (Fase 5)
             (Easypanel, red interna)     pub/sub en vivo
                         ▲                      ▲
                         │                      │
                      worker              live-ingestor
         (FastF1, Jolpica, OpenF1 hist.,  (OpenF1 MQTT,
          scoring, RSS, cola de ingesta)   solo en sesión)
                         │
                         ├─► volumen replay-assets  (chunks; los sirve nginx)
                         ├─► volumen telemetry      (Parquet; lo lee la api)
                         └─► volumen fastf1-cache   (temporal)
```

### Decisiones

| Tema | Recomendación | Por qué |
|---|---|---|
| Backend | **Python 3.12 + FastAPI**, SQLAlchemy 2 (async) + Alembic, Pydantic v2, `uv` | FastF1 solo existe en Python y así se porta `f1_data.py` directo. Un único código para api, worker e ingestor. |
| Frontend | React 19 + Vite + TS strict, Tailwind v4 (build, no CDN), TanStack Query, React Router (BrowserRouter), Zustand para el estado del player, `vite-plugin-pwa` | Continuidad con la app actual y tu stack de PWA. |
| Contrato API | OpenAPI de FastAPI → `openapi-typescript` genera los tipos del front | Tipos sincronizados sin escribir `types_db.ts` a mano. |
| Mismo origen | La API se sirve bajo `/api` en el mismo dominio; nginx hace de proxy | Simplifica las cookies httpOnly, CORS y CSRF. |
| Auth | **Propia en FastAPI**: argon2id, access JWT de 15 min + refresh rotativo (hash en DB), cookies httpOnly/Secure/SameSite=Lax, verificación de email y reset por SMTP, rate limit en Postgres (intentos por IP y email), rol `user`/`admin` en DB, borrado de cuenta | Supabase self-hosted (~10 containers) o Keycloak son demasiado para una app de fans. Es poca superficie y queda bajo control. |
| DB | Postgres 17 como servicio de Easypanel, **sin puerto público**, backups de Easypanel a S3-compatible con una prueba de restauración, migraciones Alembic versionadas | El schema y las constraints quedan en el repo (en v2 no existían). |
| Telemetría pesada | **No va a Postgres.** Replay en chunks binarios en un volumen (servidos por nginx y cacheados por Cloudflare). **Telemetría completa de todas las vueltas** en Parquet (incluye RPM, Z, en pista/fuera de pista y auto de adelante), consultada con DuckDB/pyarrow desde la API. | Una carrera a 25 FPS son ~3M filas por sesión. En Parquet o binario cuantizado son unos MB. |
| Jobs | Worker con APScheduler + cola de ingesta en Postgres (`ingest_runs`) con reintentos y `pg_advisory_lock` (un job pesado a la vez) | Simple. No justifica Celery y no necesita Redis. |
| Redis | Recién en la Fase 5, para el pub/sub del en vivo | Antes no tiene un uso que Postgres no cubra. |
| Leaderboards | Query directo con índices | Para cientos de usuarios, las vistas materializadas son complejidad sin beneficio. |
| FastF1 | Versión fijada + test de contrato de la API privada | `_extended_timing_data` puede cambiar en cualquier versión. |
| Observabilidad | Sentry (o GlitchTip self-hosted) + logs estructurados | Enterarse de que falló una ingesta o el scoring sin mirar la consola. |
| Charts | **uPlot** para telemetría y lap times (miles de puntos), SVG para estrategia de neumáticos, **Canvas 2D** para el mapa del replay | Rendimiento con series largas en mobile. |

### Servicios en Easypanel

| Servicio | Imagen | Notas |
|---|---|---|
| `postgres` | servicio Postgres de Easypanel (17) | Solo red interna; backups diarios. |
| `redis` | servicio Redis de Easypanel | **Solo desde la Fase 5.** Pub/sub del en vivo. |
| `api` | `apps/api` (Dockerfile) | `uvicorn` con 2 workers, detrás de nginx en `/api`. WebSocket por Cloudflare con ping cada ~30 s, porque Cloudflare corta las conexiones inactivas a los ~100 s. |
| `worker` | misma imagen, `command: python -m app.worker` | **RAM:** FastF1 con telemetría usa 2–4 GB por carrera. Limitar a 1 sesión a la vez y a 2 procesos (el replay usa `cpu_count()` procesos). |
| `live-ingestor` | misma imagen, `command: python -m app.live` | Solo si se contrata el acceso en vivo (§5). |
| `web` | `apps/web` (nginx) | SPA + `/replay/*` desde el volumen + proxy de `/api`. Chunks versionados con `Cache-Control: immutable` y pre-comprimidos (`gzip_static`). |
| Volúmenes | `replay-assets`, `telemetry` (Parquet, ~10 GB para 2018–2026), `fastf1-cache` (temporal: se limpia después de cada ingesta) | — |

**Tamaño del VPS:** el worker (2–4 GB), Postgres, la api y web piden **8 GB de RAM o más**. Si el servidor es más chico, los replays y el backfill se generan en la PC local y se suben los chunks y los Parquet.

## 4. Datos

### 4.1 Fuentes

| Dato | Fuente | Disponibilidad | Se guarda en |
|---|---|---|---|
| Calendario, horarios de sesión, resultados, standings, pilotos, equipos y circuitos de la temporada en curso | **Jolpica-F1** (sucesor de Ergast). API: 4 req/s y 500 req/h sin autenticación, y avisan que van a bajar | Sync diario + post-carrera | Postgres |
| Histórico 1950→hoy | **Dumps CSV de Jolpica** (gratis para uso no comercial, con 14 días de demora) | Carga inicial única | Postgres |
| Vueltas, sectores, speed traps (`SpeedI1/I2/FL/ST`), vueltas borradas y su motivo, PB, posición oficial por vuelta, stints, compuestos, neumático nuevo, pits, track status, race control, clima (con presión), resultados de qualy y práctica | **FastF1** | 2018+, entre 30 min y unas horas después de cada sesión | Postgres |
| Resultados extendidos: grilla, estado, posición clasificada, puntos, foto del piloto, color del equipo | FastF1 (`session.results`) | Post-sesión | Postgres |
| Curvas numeradas (con ángulo y distancia), luces y sectores de marshal, rotación del circuito | FastF1 (`get_circuit_info`) | Por circuito y temporada | Postgres |
| Gap al líder e intervalo oficiales | 2018–2022: FastF1 (API privada). 2023+: **OpenF1 `intervals`** | Post-sesión | Postgres |
| Adelantamientos, radio (URLs de los audios), tiempo detenido en pits (desde EE.UU. 2024), grilla de salida, DNF/DNS/DSQ | **OpenF1 histórico** (gratis) | 2023+ | Postgres |
| Posiciones x/y + telemetría de todos los autos (replay) | **FastF1** (`get_race_telemetry` portado) | Post-sesión | Chunks binarios en `replay-assets` |
| Telemetría completa de todas las vueltas: velocidad, RPM, marcha, acelerador, freno, DRS, x/y/z, en pista/fuera, auto de adelante y distancia a él | FastF1 (`lap.get_telemetry()`) | Post-sesión | Parquet por sesión |
| En vivo: posiciones, intervalos, vueltas, pits, stints, race control, clima, telemetría a 3,7 Hz | **OpenF1 real-time** (€9,90/mes, ver §5) | Durante la sesión | Redis (stream) → Postgres al cerrar |
| Piloto del Día | No está en ninguna API | Manual (admin) | Postgres |
| Noticias | RSS (formula1.com, motorsport, etc.) | Cada 30 min | Postgres |

**Plan B:** FastF1 depende del archivo estático no oficial de livetiming.formula1.com. Si deja de estar disponible, las Fases 3 y 4 se alimentan del histórico de OpenF1 (2023+, 3,7 Hz), reutilizando el normalizador OpenF1 → `Frame` de la Fase 5.

### 4.2 Modelo de datos (resumen)

**Referencia:** `seasons`, `circuits`, `circuit_markers` (curva, luz o sector de marshal: número, letra, x, y, ángulo, distancia), `drivers`, `teams`, `season_entries` (piloto-equipo-temporada-número), `events` (GP: ronda, fechas, sprint, `scoring_status`), `sessions` (tipo, `starts_at` UTC, estado, `ingested_at`).

**Resultados:** `session_results` (posición, posición clasificada, grilla, estado, puntos, tiempo, Q1/Q2/Q3, `source_hash` para detectar cambios), `driver_standings` / `constructor_standings` (snapshot por ronda).

**Timing (FastF1 + OpenF1):**
- `laps`: sesión, piloto, n°, tiempo_ms, s1/s2/s3, speed traps I1/I2/FL/ST, compuesto, vida del neumático, neumático nuevo, stint, pit in/out, posición, PB, borrada + motivo, precisa, generada por FastF1, track status, gap al líder, intervalo.
- `stints`, `pit_stops` (tiempo en el pit lane y detenido), `race_control_messages`, `weather_samples`, `track_status_changes`.
- `overtakes`, `team_radio` (2023+).
- `replay_assets` (sesión, versión, fps, n° de chunks, ruta), `telemetry_files` (sesión, ruta del Parquet, filas, tamaño).

**Ingesta:** `ingest_runs` (sesión, fuente, estado, intentos, error, duración). Es la cola con reintentos del backfill y lo que muestra el admin como estado de los jobs.

**Usuarios:** `users` (email, hash, rol, verificado), `refresh_tokens`, `profiles` (nick único, avatar, país), `email_tokens`.

**Juego:**
- `predictions` (usuario, evento, campos de qualy, sprint y carrera, `locked_at`)
- `fantasy_teams` (selección actual) + `fantasy_snapshots` (congelado por evento al cierre)
- `score_entries` (usuario, evento, categoría, puntos, **detalle JSON** para explicar cada punto)
- `leagues` + `league_members` (código de invitación)
- `guess_games` (objetivo elegido por el servidor, intentos, resultado)
- leaderboards global y por liga calculados por query

### 4.3 Contrato de frame (replay = en vivo)

Basado en el formato de `telemetry.md` de f1-race-replay. El replay y el en vivo emiten **el mismo tipo**, así la UI es una sola:

```ts
type Frame = {
  t: number;                    // segundos desde el inicio de la sesión
  lap: number;                  // vuelta del líder
  trackStatus: '1'|'2'|'4'|'5'|'6'|'7'; // verde, amarilla, SC, roja, VSC, fin de VSC
  drivers: Record<string, {     // clave: código (VER, NOR…)
    x: number; y: number;
    dist: number;               // metros dentro de la vuelta (no de carrera)
    relDist: number;            // 0–1 dentro de la vuelta
    position: number;           // posición oficial (stream de timing), no la calculada por distancia
    lap: number; speed: number; rpm: number; gear: number;
    throttle: number; brake: number;
    drs: number;                // código crudo: 10/12/14 = abierto, 8 = disponible
    tyre: number;               // 0 blando, 1 medio, 2 duro, 3 intermedio, 4 lluvia
    tyreLife: number;
    gapToLeader?: number; interval?: number; inPit?: boolean; out?: boolean;
  }>;
  // Simulado: la API no da la posición del SC. En la UI se muestra como "estimado".
  safetyCar?: { x: number; y: number; phase: 'deploying'|'on_track'|'returning'; alpha: number } | null;
  weather?: { airTemp: number; trackTemp: number; humidity: number; pressure: number; windSpeed: number; windDir: number; rain: boolean };
};
```

- **Replay:** el worker baja a 4 Hz. La fuente real va a ~3,7 Hz y las 25 FPS de race-replay ya son interpolación, así que casi no se pierde nada. El cliente interpola a 60 fps: lineal para los valores continuos y **por escalón** para marcha, DRS, neumático, vuelta y posición.
- **Formato de los chunks:** 60 s cada uno, en binario columnar:
  - x/y: uint16 cuantizado sobre el bounding box del circuito, con offset y escala en el manifest (int16 crudo no alcanza en circuitos grandes).
  - dist, speed, rpm: uint16.
  - throttle, brake, gear, drs, tyre, tyreLife, position, lap: uint8.
  - relDist se deriva de dist y el largo de la vuelta; `t` es implícito (inicio del chunk + índice / 4 Hz).

  Son ~18 bytes por piloto y muestra, unos 10 MB por carrera de 2 h sin comprimir. Los chunks se guardan pre-comprimidos (gzip/brotli), porque Cloudflare puede no comprimir `application/octet-stream`. Medir con la primera carrera real.
- **Manifest:** un `manifest.json` por sesión con pilotos, colores, polilínea y bordes del circuito, zonas de DRS, curvas, rotación, total de vueltas, race control, track status y rangos de vueltas con SC/VSC/bandera roja.
- **En vivo:** el ingestor normaliza OpenF1 a `Frame` y publica en Redis. La API hace fan-out por WebSocket (una sola conexión upstream, el token nunca llega al cliente).

### 4.4 Correcciones obligatorias al portar race-replay

| Problema | Dónde | Corrección |
|---|---|---|
| `dist` se documenta como distancia de carrera, pero es distancia dentro de la vuelta: `total_dist_so_far` nunca se acumula | `f1_data.py:184` y `:219` | Tratarlo como distancia en la vuelta (entra en uint16). El progreso de carrera es `(lap − 1) · largo + dist`. |
| Se interpolan linealmente valores que son categorías: al pasar de blando (0) a duro (2) aparece un medio (1) que nunca existió | `f1_data.py:813` | Muestreo por escalón para compuesto, vuelta, marcha y DRS, como ya hace la qualy en `:1270`. |
| Las posiciones salen de ordenar por (vuelta, dist), y `np.interp` congela en pista a los autos que abandonan | `f1_data.py:1022` | Usar la posición del stream de timing (FastF1) u OpenF1 `position` (2023+). Marcar `out` cuando termina la telemetría o el resultado indica abandono. |
| Los gaps del leaderboard se calculan con una velocidad fija de 200 km/h | `ui_components.py:313` | Gaps oficiales por vuelta; entre vueltas, `DistanceToDriverAhead` / velocidad. |
| Modelo de neumáticos: la columna `TrackCondition` no existe en FastF1 (siempre asume seco), `latent_pace` está fijo en el código y `max_tyre_life` nunca se asigna (queda en 30) | `bayesian_tyre_model.py`, `ui_components.py:491` | Derivar la condición de pista del clima y los compuestos, ajustar el ritmo base con los datos y calcular el máximo por compuesto. |
| La telemetría de prácticas no se remuestrea y tiene otro formato que la de qualy | `f1_data.py:1746` | Un único formato para todas las vueltas: el Parquet. |

### 4.5 Volumen y carga inicial

- **Jolpica histórico:** se carga desde los dumps CSV. Bajarlo por la API serían miles de pedidos a 500 por hora.
- **FastF1 2018→hoy:** ~1000 sesiones, del orden de días de procesamiento. Va a la cola `ingest_runs`: una sesión a la vez, con reintentos y retomable si se corta.
- **Almacenamiento** (estimado, hay que medirlo con una carrera): Parquet ~1 GB por temporada (~10 GB para 2018–2026) y chunks de replay de ~5–10 MB por carrera o sprint. El caché crudo de FastF1 puede pasar los 50 GB: se borra después de cada ingesta y el Parquet queda como fuente de verdad.

## 5. Pantalla en vivo: la restricción real

- **No hay una fuente gratuita y legítima de posiciones en vivo.** El feed de F1 Live Timing (que usa el cliente live de FastF1) hoy pide un token de F1 TV para tener datos completos, y usarlo así es una zona gris de los términos de F1.
- **OpenF1** (verificado en openf1.org): el histórico es gratis desde 2023 (3 req/s y 30 req/min). El tiempo real cuesta **€9,90/mes** e incluye:
  - REST, MQTT y WebSocket entre 30 min antes y 30 min después de cada sesión.
  - Hasta 10 conexiones simultáneas.
  - ~3 s de latencia y telemetría a 3,7 Hz.

  La licencia es CC BY-NC-SA 4.0, para uso no comercial.
- **Uso no comercial confirmado:** la app es de fans y sin monetizar, en línea con lo que hacen OpenF1, FastF1 y Jolpica. Las tres fuentes encajan sin licencias pagas, salvo la suscripción en vivo de OpenF1.

**Recomendación:** construir la pantalla en vivo sobre el contrato `Frame`, de manera que funcione igual con replay. Contratar OpenF1 solo cuando la Fase 5 esté lista. Sin suscripción, la pantalla "En vivo" muestra la cuenta regresiva y el timing post-sesión, y el replay queda disponible apenas termina la ingesta.

Extra de producto: durante la sesión en vivo, mostrar **"tu predicción vs. el orden actual"** con puntos provisionales. Conecta el juego con el en vivo.

## 6. Juego: cambios respecto de v2

| Tema | v2 | v3 |
|---|---|---|
| Cálculo de puntos | Edge Function disparada a mano por el admin | El worker lo ejecuta automáticamente cuando Jolpica/FastF1 publican el resultado, y **vuelve a puntuar si el resultado cambia** (penalizaciones o descalificaciones posteriores, detectadas por `source_hash`). Es idempotente: reemplaza los `score_entries` del evento en una transacción. El admin solo carga el Piloto del Día y puede pedir recalcular. |
| Estado del puntaje | No existía | `events.scoring_status`: *provisional* al publicarse el resultado y *final* cuando está cargado el Piloto del Día y pasaron 7 días sin cambios (configurable). El Piloto del Día y la predicción perfecta se suman en la segunda pasada. |
| Cierre de predicciones | Solo en la UI | **En el servidor**: los campos de qualy/carrera cierran al inicio de la qualy y los de sprint al inicio de la sprint qualy (configurable) |
| Fantasy team | Se usaba el equipo *actual* para puntuar carreras pasadas | Snapshot congelado por evento al cierre; los cambios cuentan desde el evento siguiente; `changes_remaining` lo controla el servidor |
| Puntos del fantasy | Incluía +1 por vuelta rápida | Sistema vigente de F1 (sin punto por VR desde 2025) + puntos de sprint |
| Reglas de predicción | Sprint y "predicción perfecta" definidas pero no calculadas | Se implementan todas. Reglas versionadas por temporada en código (`scoring/v2026.py`) con tests |
| Explicación de puntos | No había | `score_entries.detail`: "Pole VER +10, P1 exacto +25…" |
| Adiviná el piloto | El objetivo y el contador vivían en el cliente | El servidor elige el piloto y valida cada intento; límite diario por `user_id` + fecha UTC |
| Ligas | Solo mencionadas | Ligas privadas con código de invitación y leaderboard propio |
| Admin | Email hardcodeado en el front | `users.role = 'admin'`, verificado en cada endpoint |

## 7. Mapa de pantallas

| Pantalla | Contenido | Origen |
|---|---|---|
| Inicio | Próxima sesión con cuenta regresiva, predicción pendiente, tu ranking, último resultado, noticias | v2 rediseñada |
| Calendario | Temporada con horarios locales y estado de cada sesión → link a análisis/replay | v2 + datos reales |
| Evento (GP) | Tabs por sesión (FP1–3, SQ, S, Q, R): resultados, vueltas, estrategia, race control, clima, radio (2023+), **Replay** | nueva |
| Análisis de sesión | Lap chart, posiciones por vuelta, gaps oficiales, estrategia de neumáticos, sectores (PB/SB), speed traps, vueltas borradas (track limits), adelantamientos (2023+), comparador de telemetría (velocidad/acelerador/freno/marcha/RPM vs distancia + delta) sobre el mapa con curvas numeradas, long runs en FP | insights de race-replay |
| Replay | Mapa en canvas, timing tower con gaps oficiales, controles (0,5×–64×, seek, ←/→), SC (estimado), clima, race control, panel de telemetría del piloto seleccionado, salud del neumático (Fase 6, estimada) | `race_replay.py` |
| **En vivo** | Igual que el replay + intervalos en vivo + "tu predicción vs. ahora" | nueva |
| Campeonato | Pilotos y constructores con evolución por ronda (gráfico) | v2 + datos reales |
| Estadísticas | Pilotos, equipos y circuitos con histórico, récords, comparador entre compañeros, archivo de temporadas desde 1950 | nueva (Jolpica) |
| Predicciones | Form por evento + historial con detalle de puntos | v2 |
| Mi Equipo | Fantasy con cambios restantes y snapshot por evento | v2 |
| Rankings | Global por temporada + ligas | v2 + ligas |
| Adiviná el piloto | Mismo juego, validado en el servidor | v2 |
| Perfil / Reglas / Auth | Igual que v2 + verificación de email, reset de contraseña y borrado de cuenta | v2 |
| Admin | Piloto del Día, recalcular, re-ingestar una sesión, cola de ingesta (estado, reintentos, errores) | v2 ampliada |

## 8. API (borrador)

Todo bajo `/api` en el mismo origen que la web.

```
POST /api/auth/{register,login,refresh,logout,verify,forgot,reset}
GET  /api/me                     PATCH /api/me/profile        DELETE /api/me
GET  /api/seasons/{y}/events     GET /api/events/{id}         GET /api/sessions/{id}
GET  /api/sessions/{id}/{results,laps,stints,pits,race-control,weather,intervals,overtakes,team-radio}
GET  /api/sessions/{id}/telemetry?driver=VER&lap=12
GET  /api/sessions/{id}/replay/manifest      (chunks: /replay/{session}/{v}/{n}.bin vía nginx)
GET  /api/standings/{y}/{drivers|constructors}?round=
GET  /api/drivers/{id}  /api/teams/{id}  /api/circuits/{id}   (+ /stats)
GET  /api/circuits/{id}/markers
GET|PUT /api/predictions/{eventId}   GET /api/predictions/history
GET|PUT /api/fantasy/team
GET  /api/leaderboards/{y}       POST /api/leagues   POST /api/leagues/join   GET /api/leagues/{id}/leaderboard
POST /api/guess-game/start       POST /api/guess-game/{id}/guess
POST /api/admin/events/{id}/dotd     POST /api/admin/events/{id}/rescore   POST /api/admin/sessions/{id}/ingest
GET  /api/admin/ingest-runs
WS   /api/live/{sessionId}
```

## 9. Estructura del repo

```
f1-predictor-pro/                 ← repo nuevo (ver §11)
├── CLAUDE.md                      convenciones, comandos y reglas para Claude Code
├── apps/
│   ├── web/                       React + Vite (se migran páginas y componentes de v2)
│   └── api/
│       ├── app/{auth,routers,models,services,scoring,live,worker}/
│       ├── f1data/                port de f1_data.py + lógica de vueltas y gaps de race_replay.py
│       │                          + modelo de neumáticos + lib/{sectors,tyres,time}.py
│       ├── alembic/
│       └── tests/                 incluye tests de contrato de FastF1 (API privada) y de scoring
├── infra/
│   ├── docker-compose.dev.yml     postgres + api + worker + web (redis desde la Fase 5)
│   ├── nginx/
│   └── easypanel.md               servicios, variables, volúmenes, backups
├── .github/workflows/ci.yml       ruff + mypy + pytest | eslint + tsc + vitest + build
└── THIRD_PARTY_NOTICES.md
```

## 10. Plan por fases

Tamaños relativos: S (días), M (1–2 semanas), L (2–4 semanas), XL (más de un mes), a ritmo part-time. Cada fase es un plan para Claude Code (plan mode → PR).

| Fase | Entregable | Tamaño | Criterio de "listo" |
|---|---|---|---|
| **0. Fundaciones** | Monorepo, CLAUDE.md, docker-compose dev, Dockerfiles, CI, Postgres en Easypanel, Alembic baseline, healthchecks, Sentry, nginx con `/api` en el mismo origen | S | `docker compose up` levanta todo; el CI pasa; deploy en Easypanel de un "hello" api + web |
| **1a. Temporada en curso** | Sync de Jolpica (API) solo para la temporada en curso: calendario, sesiones, resultados, standings, pilotos y equipos; páginas de Calendario y Campeonato | S | Temporada 2026 completa y correcta; re-sync idempotente |
| **2. Usuarios + juego (paridad segura)** | Auth completa (con borrado de cuenta), perfil, predicciones con cierre en el servidor, fantasy con snapshots, scoring automático con re-scoring y tests, rankings, ligas, Adiviná el piloto en el servidor, admin | L | Tests de scoring con casos reales, incluida una descalificación posterior a la carrera; no hay forma de escribir puntos desde el cliente |
| **1b. Histórico + estadísticas** | Carga de los dumps de Jolpica (1950→hoy); páginas de Pilotos, Equipos, Circuitos, Récords y Archivo | M | Los totales históricos (victorias, poles, títulos) coinciden con fuentes públicas en una muestra |
| **3. Análisis de sesión** | Port de `f1_data.py` + lógica de `race_replay.py` con las correcciones de §4.4; ingesta FastF1 post-sesión (vueltas extendidas, stints, pits, RC, clima, circuito, telemetría completa en Parquet); complemento OpenF1 2023+ (intervals, adelantamientos, radio, pits); cola `ingest_runs` y backfill 2018→hoy; páginas de análisis y comparador | XL | Una carrera y una qualy se ingieren solas después de la sesión; el backfill 2018→hoy se completa y se puede retomar |
| **4. Race Replay web** | Generación de chunks + manifest, player (canvas + timing tower + controles + SC + panel de telemetría) | L | Replay fluido a 60 fps en mobile de gama media; < 10 MB por carrera comprimido |
| **5. En vivo** | Redis + live-ingestor (OpenF1 MQTT) → Redis → WS; pantalla en vivo reutilizando el player; "tu predicción vs. ahora" | M | Prueba en una sesión real (FP) sin cortes; reconexión automática |
| **6. Extras** | Modelo de degradación de neumáticos (con las correcciones de §4.4), push de la PWA ("cierra tu predicción en 1 h"), noticias RSS, i18n | M | — |

**Timing:** hoy (octubre 2026) la temporada termina a principios de diciembre. Objetivo razonable: Fases 0, 1a y 2 listas para el arranque de 2027.

Las Fases 3 y 4 no necesitan carreras en vivo para probarse, porque FastF1 sirve sesiones pasadas. Las carreras en vivo solo importan para validar la ingesta automática post-sesión y la Fase 5. **Opcional:** aprovechar las últimas carreras de 2026 con un prototipo rápido del formato de chunks y del player sobre una carrera, para validar el contrato `Frame` antes de fijarlo.

## 11. Decisiones

### Tomadas

- **Uso no comercial:** confirmado. Condiciona tres fuentes: OpenF1 (CC BY-NC-SA 4.0), los dumps gratuitos de Jolpica y los datos de FOM. Si eso cambia, hay que revisar §4.1 y §5.
- **Máximo de datos de race-replay:** se porta toda su capa de datos (§1) y se suma lo que FastF1 y OpenF1 entregan y race-replay descarta (§4.1).

### Pendientes

1. **Repo nuevo** (recomendado): el historial de v2 es público y contiene secretos: la key de Gemini en `.env`, la anon key de Supabase en `supabaseClient.ts` y la URL del pooler en `supabase/.temp/`. Borrar `.env` en el último commit no los saca del historial. Conviene arrancar limpio y copiar solo componentes y reglas. La key de Gemini ya fue revocada (12/10/2026) y las credenciales de Supabase ya no sirven porque el proyecto fue borrado.
2. **Tamaño del VPS:** 8 GB de RAM o más, o generar los replays y el backfill en la PC local.
3. **Pagar OpenF1 real-time** para la Fase 5 (se decide recién al llegar a esa fase).
4. **SMTP** para verificación de email y reset: qué proveedor o servidor usar.
