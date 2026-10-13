# Fase 4 — Race Replay web: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Generar, para cada carrera y sprint ingerida, chunks binarios de 60 s a 4 Hz + un `manifest.json`, servidos por nginx y cacheados por Cloudflare, y un player en el browser (mapa en Canvas 2D, timing tower con gaps oficiales, controles 0,5×–64×, seek, Safety Car estimado, clima, race control y panel de telemetría) fluido a 60 fps en un móvil de gama media y con < 10 MB por carrera.

**Arquitectura:** El worker (`replay_build`) **no vuelve a llamar a FastF1**: lee el Parquet de la Fase 3, `laps`, `track_status_changes`, `weather_samples` y `circuit_layouts`, construye `Frame`s (§4.3) con las correcciones §4.4 y los serializa con `f1data/replay_codec.py`. Los chunks se escriben como `{n}.bin.gz` (gzip) y el cliente los descomprime con `DecompressionStream` y los decodifica en un Web Worker. El estado del player vive en Zustand; el dibujo es imperativo (Canvas) y no re-renderiza React por frame.

**Tech Stack:** numpy, pyarrow/duckdb, `struct`/`numpy.tobytes`, gzip; web: Zustand 5, Canvas 2D, Web Worker, `DecompressionStream`, uPlot (panel de telemetría del piloto).

**Spec:** `propuesta.md` §2.3, §4.3 (contrato `Frame`, formato de chunks, manifest), §4.4, §7 (Replay), §8, §10 fila "4". **Plan maestro:** §3.2 (replay), §3.3.

## Restricciones globales

- `Frame` exactamente como §4.3 (claves y unidades). `dist` = metros dentro de la vuelta; `relDist` derivado; `t` implícito.
- 4 Hz en el worker; el cliente interpola a 60 fps: lineal (x, y, dist, speed, rpm, throttle, brake), **por escalón** (gear, drs, tyre, tyreLife, lap, position, inPit, out).
- Chunks de 60 s; x/y uint16 cuantizados sobre el bounding box del circuito con `offset` y `scale` en el manifest; dist/speed/rpm uint16; resto uint8. Pre-comprimidos. `Cache-Control: immutable` con carpeta versionada.
- Manifest con pilotos, colores, polilínea y bordes, zonas DRS, curvas, rotación, total de vueltas, race control, track status y rangos SC/VSC/roja.
- Posición = oficial del stream (`laps.position` al fin de vuelta + OpenF1 `position` 2023+), nunca por distancia. `out` cuando termina la telemetría o el resultado indica abandono. SC simulado se muestra como "estimado".

## Foco de revisión

1. **Chunk corrupto o truncado** (descarga cortada): el decodificador valida `magic`, `version` y que el largo coincida con `header + nDrivers*nSamples*19 + …`; si falla, el player muestra "Replay no disponible en este tramo" y sigue con el siguiente chunk. Test T2 (Python) y T5 (TS).
2. **Manifest viejo vs chunks nuevos** (rebuild mientras alguien mira): la carpeta es `v{N}`; el manifest nuevo se escribe al final y el viejo se borra 10 min después; el cliente que ya cargó `v{N-1}` sigue funcionando hasta recargar. Test T3.
3. **Circuito grande** (Spa 7 km, bbox > 32 km en coordenadas de FastF1 ×10): `scale` se calcula del bbox real, y se verifica que ningún valor sature uint16. Test T2 (`test_quantization_no_saturation_on_spa_like_bbox`).
4. **Piloto que entra a pits durante un cambio de chunk:** `inPit` viene del flag por muestra, no de un evento, así que el estado sobrevive al cambio. Test T1.
5. **Seek a 64× en móvil:** se piden a lo sumo 2 chunks adelante y se cancelan fetches obsoletos con `AbortController`; el canvas limita a `devicePixelRatio ≤ 2`. Test T6 manual en navegador interno con throttling.

---

### Tarea 1: Construcción de frames a 4 Hz (`f1data/frames.py`, port corregido de `get_race_telemetry`)

**Archivos:**
- Crear: `f1data/frames.py`, `f1data/safety_car.py`
- Test: `tests/f1data/test_frames.py` (fixture Parquet sintético de 3 pilotos × 5 vueltas, uno abandona en la 3), `tests/f1data/test_safety_car.py`

**Interfaces:**
- `@dataclass FrameSet(t0_ms: int, fps: int, n: int, drivers: list[str], track_status: np.ndarray[uint8], cols: dict[str, np.ndarray])` con `cols` de forma `(nDrivers, n)`: `x, y` (float32, metros), `dist` (float32), `speed, rpm` (uint16), `throttle, brake, gear, drs, tyre, tyre_life, position, lap` (uint8), `in_pit, out` (bool); `sc: SafetyCarTrack | None` (`x, y` float32 `(n,)`, `phase` uint8 `(n,)` 0 none/1 deploying/2 on_track/3 returning, `alpha` uint8).
- `build_frames(telemetry_parquet: Path, laps: pd.DataFrame, track_status: pd.DataFrame, results: pd.DataFrame, *, fps=4, session_t0_ms: int, session_end_ms: int) -> FrameSet`:
  - timeline `t = arange(t0, end, 1000/fps)` en ms de sesión;
  - por piloto, concatena las vueltas del Parquet (`t_ms`, `x, y, distance, rel_distance, speed, rpm, gear, throttle, brake, drs`) y:
    - continuos: `np.interp(t, t_tel, v)` **solo dentro de `[t_tel[0], t_tel[-1]]`**; fuera → `out=True` y se congela la última posición (así no "corren" los autos retirados, corrección §4.4-3);
    - categóricos: `idx = searchsorted(t_tel, t, 'right') - 1` (escalón, corrección §4.4-2) para `gear, drs, tyre, tyre_life, lap`;
    - `dist` = `distance` del Parquet **dentro de la vuelta** (corrección §4.4-1); `rel_dist` = `rel_distance`;
    - `position`: escalón sobre `laps.position` indexado por `lap_start_ms` (fin de vuelta anterior) — si hay `openf1_positions` (DataFrame opcional `t_ms, driver, position`), se usa ese con escalón (más fino);
    - `in_pit`: `pit_in_ms <= t < pit_out_ms` de la vuelta siguiente;
    - `tyre` desde `compound` con `get_tyre_compound_int`.
  - `track_status`: escalón sobre `track_status_changes` (`'1'..'7'` → uint8 del dígito).
- `safety_car.py`: `simulate_safety_car(frames: FrameSet, layout: Layout, sc_periods: list[tuple[int, int]]) -> SafetyCarTrack` (port de `_compute_safety_car_positions`: el SC sale de pits en `deploying`, avanza por la polilínea de referencia a 80 km/h hasta ubicarse delante del líder, `on_track` mientras dura el período, `returning` al final con `alpha` decreciente 1→0 en 10 s).

- [ ] **Paso 1: Tests (fallan primero)**

```python
def test_frames_step_sampling_for_categorical(frames_fixture: FrameSet) -> None:
    gear = frames_fixture.cols["gear"][0]
    assert set(np.unique(gear)) <= set(range(0, 9))             # nunca 6.5
    tyre = frames_fixture.cols["tyre"][0]
    assert set(np.unique(tyre)) <= {0, 1, 2, 3, 4}               # nunca un "medio" inventado entre blando y duro

def test_retired_driver_is_out_and_frozen(frames_fixture: FrameSet) -> None:
    i = frames_fixture.drivers.index("STR")
    out = frames_fixture.cols["out"][i]
    first_out = int(np.argmax(out))
    assert out[first_out:].all() and not out[:first_out].any()
    assert np.allclose(frames_fixture.cols["x"][i][first_out:], frames_fixture.cols["x"][i][first_out])

def test_dist_is_within_lap_not_race(frames_fixture: FrameSet, lap_length_m: float) -> None:
    assert frames_fixture.cols["dist"].max() <= lap_length_m * 1.01

def test_position_from_timing_not_distance(frames_fixture: FrameSet) -> None:
    # en la fixture, en t=120s el piloto NOR va 2º por timing aunque esté más adelante en dist por un pit del líder
    k = int((120_000 - frames_fixture.t0_ms) / 250)
    i = frames_fixture.drivers.index("NOR")
    assert frames_fixture.cols["position"][i][k] == 2

def test_in_pit_flag_persists_across_chunk_boundary(frames_fixture: FrameSet) -> None:
    i = frames_fixture.drivers.index("VER"); ip = frames_fixture.cols["in_pit"][i]
    k = 240  # muestra 240 = 60 s = borde de chunk; la fixture mete a VER en pits de 58 s a 63 s
    assert ip[k - 1] and ip[k] and ip[k + 1]

def test_safety_car_phases(frames_fixture, layout_fixture) -> None:
    sc = simulate_safety_car(frames_fixture, layout_fixture, sc_periods=[(200_000, 260_000)])
    assert sc.phase[int((210_000 - frames_fixture.t0_ms) / 250)] in (1, 2)
    assert sc.phase[int((270_000 - frames_fixture.t0_ms) / 250)] == 0 and sc.alpha[-1] == 0
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(f1data): frames a 4 Hz desde Parquet con muestreo por escalón, posición oficial, abandonos y Safety Car simulado`.

---

### Tarea 2: Codec binario y escritura de chunks + manifest

**Archivos:**
- Crear: `f1data/replay_codec.py`, `f1data/replay_writer.py`
- Test: `tests/f1data/test_replay_codec.py`, `tests/f1data/test_replay_writer.py`; genera `tests/f1data/fixtures/replay/0.bin` y `manifest.json` (chicos) que el front reutiliza en T5.

**Interfaces:**
- Layout binario **v1**, little-endian:

```
offset  tamaño          campo
0       4               magic "F1RP"
4       1               version = 1
5       1               fps
6       1               nDrivers (D)
7       1               flags: bit0 = tiene Safety Car
8       2  u16          nSamples (N)
10      4  u32          startMs (ms desde el inicio de la sesión)
14      3*D             códigos de piloto (ASCII, 3 bytes c/u)
…       N  u8           trackStatus por muestra
…       D*N*2  u16      x
…       D*N*2  u16      y
…       D*N*2  u16      dist
…       D*N*2  u16      speed
…       D*N*2  u16      rpm
…       D*N    u8       throttle
…       D*N    u8       brake
…       D*N    u8       gear
…       D*N    u8       drs
…       D*N    u8       tyre
…       D*N    u8       tyreLife
…       D*N    u8       position
…       D*N    u8       lap
…       D*N    u8       flags (bit0 inPit, bit1 out)
[si SC] N*2 u16 x, N*2 u16 y, N u8 phase, N u8 alpha
```

  Por piloto y muestra: 5×2 + 9×1 = **19 bytes**. Carrera de 2 h a 4 Hz con 20 pilotos: 28 800 × 20 × 19 ≈ 10,9 MB sin comprimir; gzip ≈ 3–5 MB.
- `Quant(x0: float, y0: float, scale: float)` con `scale = max(bbox_w, bbox_h) / 65535`; `q(v, axis) = round((v - v0) / scale)` con `np.clip(0, 65535)`; `Quant.from_frames(fs: FrameSet) -> Quant` toma el bounding box de `cols["x"]`/`cols["y"]` (ignorando `NaN`).
- `championship_by_lap(laps, results, standings_before: dict) -> dict[str, list[dict]]` (port de `f1_data.get_live_standings`): puntos y posición provisional de pilotos y constructores al final de cada vuelta, según el orden oficial; va al manifest como `championship: {drivers: [[{code, points, position}] por vuelta], teams: [...]}` y alimenta el overlay "Campeonato" del player (T5).
- `encode_chunk(fs: FrameSet, start: int, end: int, quant: Quant) -> bytes`; `decode_chunk(b: bytes) -> DecodedChunk` (para tests y para el worker de validación); `ChunkFormatError`.
- `write_replay(fs: FrameSet, manifest: dict, out_root: Path, session_id: int, *, chunk_seconds=60) -> ReplayWriteReport(version, chunks, bytes_raw, bytes_gz, path)`: escribe en `out_root/{session_id}/v{N}/` (N = max existente + 1) los `{n}.bin.gz` (`gzip.compress(level=6)`) y al final `manifest.json`; devuelve el reporte. El borrado de `v{N-1}` lo hace el handler 10 min después (T3).
- Manifest (`manifest.json`):

```json
{
  "version": 1, "sessionId": 123, "fps": 4, "chunkSeconds": 60, "chunks": 121, "startMs": 0, "endMs": 7260000,
  "quant": {"x0": -4800.5, "y0": -2100.0, "scale": 0.1831},
  "drivers": [{"code": "VER", "number": 1, "name": "Max Verstappen", "team": "Red Bull", "color": "#3671C6"}],
  "track": {"rotation": 92.0, "lapLengthM": 5412.0, "polyline": [[x,y],…], "innerEdge": [[x,y],…], "outerEdge": [[x,y],…],
            "drsZones": [[startM, endM],…], "corners": [{"n": 1, "letter": "", "x": 0, "y": 0, "angle": 0, "distanceM": 0}]},
  "totalLaps": 57,
  "raceControl": [{"tMs": 0, "lap": 1, "category": "Flag", "flag": "GREEN", "message": "GREEN LIGHT - PIT EXIT OPEN"}],
  "trackStatusRanges": [{"status": "4", "fromMs": 200000, "toMs": 260000, "lapFrom": 30, "lapTo": 33}],
  "weather": [{"tMs": 0, "airTemp": 28.1, "trackTemp": 41.0, "humidity": 40, "pressure": 1012.3, "windSpeed": 2.1, "windDir": 180, "rain": false}],
  "safetyCarEstimated": true,
  "championship": {"drivers": [[{"code": "VER", "points": 25.0, "position": 1}]], "teams": [[{"ref": "red_bull", "points": 43.0, "position": 1}]]},
  "results": [{"code": "VER", "position": 1, "status": "Finished"}]
}
```

- [ ] **Paso 1: Tests (fallan primero)**

```python
def test_roundtrip_exact_for_uint_fields(frames_fixture) -> None:
    q = Quant.from_frames(frames_fixture)
    b = encode_chunk(frames_fixture, 0, 240, q)
    d = decode_chunk(b)
    assert d.n == 240 and d.drivers == frames_fixture.drivers
    np.testing.assert_array_equal(d.cols["gear"], frames_fixture.cols["gear"][:, :240])
    np.testing.assert_allclose(d.cols["x"], frames_fixture.cols["x"][:, :240], atol=q.scale)

def test_bytes_per_driver_sample_is_19(frames_fixture) -> None:
    q = Quant.from_frames(frames_fixture); b = encode_chunk(frames_fixture, 0, 240, q)
    D, N = len(frames_fixture.drivers), 240
    assert len(b) == 14 + 3 * D + N + D * N * 19 + (N * 6 if frames_fixture.sc else 0)

def test_truncated_chunk_raises(frames_fixture) -> None:
    b = encode_chunk(frames_fixture, 0, 240, Quant.from_frames(frames_fixture))
    with pytest.raises(ChunkFormatError): decode_chunk(b[:-10])
    with pytest.raises(ChunkFormatError): decode_chunk(b"XXXX" + b[4:])

def test_quantization_no_saturation_on_spa_like_bbox() -> None:
    xs = np.array([[-40000.0, 42000.0]]); ys = np.array([[-12000.0, 30000.0]])
    q = Quant(x0=-40000.0, y0=-12000.0, scale=max(82000.0, 42000.0) / 65535)
    assert q.q(xs).max() == 65535 and q.q(ys).max() < 65535

def test_write_replay_versions_and_manifest_last(tmp_path, frames_fixture, manifest_fixture) -> None:
    r1 = write_replay(frames_fixture, manifest_fixture, tmp_path, 7); r2 = write_replay(frames_fixture, manifest_fixture, tmp_path, 7)
    assert r1.version == 1 and r2.version == 2 and (tmp_path / "7" / "v2" / "manifest.json").exists()
    assert sorted(p.name for p in (tmp_path / "7" / "v2").iterdir())[0] == "0.bin.gz"
    assert r2.bytes_gz < r2.bytes_raw * 0.6
```

- [ ] **Paso 2: Implementar (encode con numpy) y commit**

```python
def encode_chunk(fs: FrameSet, start: int, end: int, q: Quant) -> bytes:
    D, N = len(fs.drivers), end - start
    parts = [b"F1RP", bytes([1, fs.fps, D, 1 if fs.sc else 0]), struct.pack("<HI", N, int(fs.t0_ms + start * 1000 / fs.fps))]
    parts.append("".join(c.ljust(3)[:3] for c in fs.drivers).encode("ascii"))
    parts.append(fs.track_status[start:end].astype("<u1").tobytes())
    for name, conv in (("x", lambda a: q.q(a, "x")), ("y", lambda a: q.q(a, "y")), ("dist", lambda a: np.clip(np.rint(a), 0, 65535)),
                       ("speed", None), ("rpm", None)):
        a = fs.cols[name][:, start:end]
        parts.append((conv(a) if conv else a).astype("<u2").tobytes())
    for name in ("throttle", "brake", "gear", "drs", "tyre", "tyre_life", "position", "lap"):
        parts.append(np.clip(fs.cols[name][:, start:end], 0, 255).astype("<u1").tobytes())
    flags = (fs.cols["in_pit"][:, start:end].astype("<u1") | (fs.cols["out"][:, start:end].astype("<u1") << 1))
    parts.append(flags.tobytes())
    if fs.sc:
        parts += [q.q(fs.sc.x[start:end], "x").astype("<u2").tobytes(), q.q(fs.sc.y[start:end], "y").astype("<u2").tobytes(),
                  fs.sc.phase[start:end].astype("<u1").tobytes(), fs.sc.alpha[start:end].astype("<u1").tobytes()]
    return b"".join(parts)
```

Commit: `feat(f1data): codec binario v1 de chunks de replay, escritura versionada y manifest`.

---

### Tarea 3: Handler `replay_build`, endpoint del manifest y nginx

**Archivos:**
- Crear: `app/worker/jobs/replay_build.py`, `app/models/replay.py` (`ReplayAsset(id, session_id, version, fps, chunks, path, bytes, created_at)`), migración `0007_replay`, `app/routers/replay.py`
- Modificar: `apps/web/nginx/nginx.conf.template` (`location ^~ /replay/`: `types { application/gzip gz; application/json json; }`, `add_header Cache-Control "public, max-age=31536000, immutable"`, sin `gzip` dinámico para `.gz`), `app/worker/scheduler.py` (`HANDLERS["replay_build"]`, job `cleanup_old_replay_versions` cada 10 min)
- Test: `tests/test_replay_build.py`, `tests/test_replay_endpoint.py`

**Interfaces:**
- `async def build_replay(db, run: IngestRun)`: `target="session:{id}"`; exige `telemetry_files` + `laps` + `circuit_layouts`; arma `FrameSet` (T1), SC (si hay rangos `'4'`), manifest, `write_replay` a `settings.replay_root` (`/data/replay`), inserta `replay_assets`, marca `sessions.replay_available=true`.
- `GET /api/sessions/{id}/replay/manifest` → 404 `replay_unavailable` o `{ "baseUrl": "/replay/{id}/v{N}/", …manifest }` con `public_cache(300)`.
- Limpieza: versiones `< max` con `created_at < now - 10 min` → `rmtree`.

- [ ] **Paso 1: Tests, implementación, generar el replay de Bahréin 2025 R y medir**

```bash
cd apps/api && uv run python -m app.worker run-queue --once   # tras encolar replay_build para la sesión
du -sh /data/replay/<id>/v1 && curl -sI http://localhost:8080/replay/<id>/v1/0.bin.gz | grep -iE "content-type|cache-control"
```

Expected: carpeta < 10 MB; `content-type: application/gzip`; `cache-control: public, max-age=31536000, immutable`. Anotar el tamaño real en `infra/easypanel.md`. Commit: `feat(worker): generación de replay por sesión, manifest por API y servido inmutable por nginx`.

---

### Tarea 4: Player — carga, decodificación e interpolación (sin UI)

**Archivos:**
- Crear: `src/features/replay/types.ts` (`Frame` de §4.3 en TS, `Manifest`), `src/features/replay/codec.ts` (`decodeChunk(buf: ArrayBuffer): DecodedChunk`, `ChunkFormatError`), `src/workers/replay.worker.ts` (recibe `ArrayBuffer`, decodifica, devuelve typed arrays transferibles), `src/features/replay/loader.ts` (`ChunkLoader(baseUrl, manifest)`: `get(n): Promise<DecodedChunk>` con `fetch` + `DecompressionStream('gzip')`, LRU de 6 chunks, prefetch `n+1`, `AbortController` por chunk), `src/features/replay/interpolate.ts` (`frameAt(chunk, tMs, manifest): Frame` lineal/escalón), `src/features/replay/store.ts` (Zustand: `tMs, playing, speed, selectedDriver, mode: 'replay'|'live', setSpeed, seek, togglePlay`)
- Test: `tests/replay/codec.test.ts` (decodifica `tests/f1data/fixtures/replay/0.bin` copiado a `apps/web/tests/fixtures/`), `tests/replay/interpolate.test.ts`, `tests/replay/loader.test.ts` (fetch simulado, LRU, abort)

**Interfaces:**
- `decodeChunk` valida `magic`, `version === 1`, y `buf.byteLength === 14 + 3*D + N + D*N*19 + (sc ? 6*N : 0)`; devuelve `{ startMs, fps, n, drivers, trackStatus: Uint8Array, cols: { x: Uint16Array, … }, sc? }`.
- `frameAt(chunk, tMs)`: `k = (tMs - startMs) * fps / 1000`; `i = floor(k)`, `f = k - i`; continuos `a + (b - a) * f`; categóricos `cols[i]`; `x = x0 + xq * scale`; `relDist = dist / lapLengthM`; `drivers` como `Record<code, …>`; `safetyCar` si `sc.phase[i] !== 0`.

- [ ] **Paso 1: Tests (fallan primero)**

```ts
test('decodeChunk lee la fixture generada por Python', async () => {
  const buf = await readFixture('replay/0.bin');
  const c = decodeChunk(buf);
  expect(c.drivers).toEqual(['VER', 'NOR', 'STR']); expect(c.n).toBe(240); expect(c.cols.gear[0]).toBeLessThanOrEqual(8);
});
test('chunk truncado lanza ChunkFormatError', async () => { const buf = await readFixture('replay/0.bin'); expect(() => decodeChunk(buf.slice(0, buf.byteLength - 5))).toThrow(ChunkFormatError); });
test('frameAt interpola lineal y escalona categóricos', () => {
  const c = syntheticChunk({ x: [[0, 100]], gear: [[3, 4]], fps: 4, startMs: 0 });
  const f = frameAt(c, 125, manifestWith({ x0: 0, y0: 0, scale: 1 }));
  expect(f.drivers.VER.x).toBeCloseTo(50); expect(f.drivers.VER.gear).toBe(3);
});
test('loader prefetch y abort', async () => { /* fetch mock cuenta llamadas; seek lejano aborta el prefetch previo */ });
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(web): decodificador de chunks, loader con DecompressionStream y prefetch, interpolación y store del player`.

---

### Tarea 5: Player — UI (mapa Canvas, tower, controles, SC, clima, race control, panel de piloto)

**Archivos:**
- Crear: `src/features/replay/ReplayPage.tsx` (`/sesiones/:id/replay`), `useReplayClock.ts` (rAF: `tMs += dt * speed`; clamp a `[startMs, endMs]`; pausa al terminar), `TrackCanvas.tsx` (dibuja una vez la pista en un canvas de fondo y por frame solo los autos y el SC; rotación del manifest; `devicePixelRatio` ≤ 2; pinch-zoom y pan con `pointer` events; autos como círculos de 6 px con el código al lado para el seleccionado y el top 3; SC en amarillo con etiqueta "SC (estimado)" y `alpha`), `TimingTower.tsx` (ordenada por `position`; columnas: pos, código con color de equipo, gap al líder o intervalo (toggle), neumático con vida, chip `PIT`/`OUT`; en desktop a la derecha con `overflow-y-auto`; en móvil barra inferior horizontal scrolleable con la fila del seleccionado fija; se actualiza a 4 Hz, no a 60), `Controls.tsx` (▶/⏸, velocidad `0.5, 1, 2, 4, 8, 16, 32, 64`, seek `input[type=range]` con marcas de vuelta y bandas amarillas/rojas de los rangos de estado, botones ±10 s y vuelta ±1, atajos `Espacio`, `←/→`, `[`/`]`), `DriverPanel.tsx` (velocidad grande, marcha, barras acelerador/freno, DRS, RPM, vuelta y tiempo de vuelta actual tomado de `laps`), `WeatherBadge.tsx`, `RaceControlFeed.tsx` (mensajes con `tMs <= t`, autoscroll), `ChampionshipOverlay.tsx` (tabla plegable Pilotos/Constructores con los puntos provisionales al final de la vuelta actual, desde `manifest.championship`; port funcional de `DriversChampionshipOverlay`/`ConstructorsChampionshipOverlay` de `ui_components.py`)
- Modificar: `src/features/event/SessionTabs.tsx` (botón "Replay" cuando `replay_available`), `src/routes.tsx`, `src/i18n/es.ts`
- Test: `tests/replay/Controls.test.tsx`, `tests/replay/TimingTower.test.tsx` (orden por posición y chip OUT)

**Interfaces:**
- Layout: desktop `grid grid-cols-[1fr_280px] grid-rows-[1fr_auto]` (mapa | tower, controles abajo, panel de piloto superpuesto abajo a la izquierda); móvil `flex-col` con mapa `aspect-[4/3]` arriba, controles, tower horizontal y panel de piloto colapsable; orientación apaisada sugerida con un aviso descartable.

- [ ] **Paso 1: Tests, implementación, verificación en navegador, commit**

Verificación en navegador interno (Bahréin 2025 R):
1. Desktop: play a 1×, 8×, 64×; seek al minuto 50; vuelta ±1; seleccionar VER → panel muestra telemetría; SC estimado aparece en el rango amarillo; tower con gaps oficiales (comparar con `/api/sessions/{id}/intervals`); race control avanza.
2. Móvil (375×812): mapa completo sin scroll horizontal, controles ≥ 44 px, tower scrolleable, pinch-zoom; play 30 s y leer `performance.now()` por frame con `javascript_tool` (`requestAnimationFrame` loop de 300 frames) → promedio ≥ 55 fps en el navegador interno sin throttling; con `resize_window` + CPU 4× (DevTools) ≥ 30 fps como referencia.
3. `read_network_requests`: chunks desde `/replay/...` con `cache-control: immutable`; prefetch de un chunk por delante; al seek lejano se abortan fetches.
4. Consola sin errores; `read_console_messages pattern: "Replay"` sin warnings de chunk.

Commit: `feat(web): player de Race Replay con mapa, timing tower, controles, Safety Car, clima y panel de telemetría`.

---

### Tarea 6: Rendimiento y PWA offline parcial

**Archivos:**
- Modificar: `apps/web/vite.config.ts` (workbox: `runtimeCaching` `CacheFirst` para `/replay/*` con `maxEntries: 400, maxAgeSeconds: 7 días`), `TrackCanvas.tsx` (`OffscreenCanvas` para la pista si está disponible), `lighthouserc.json` (agregar `/sesiones/<id>/replay` con `performance ≥ 0.8`)
- Test: `e2e/replay.spec.ts` (carga el manifest, reproduce 5 s, verifica que `tMs` avanzó y que la tower tiene 20 filas; proyecto `mobile`)

- [ ] **Paso 1: Medir, ajustar, commit**

Presupuesto: bundle del player ≤ 120 kB gz (chunk propio por `React.lazy`); memoria < 150 MB con 6 chunks en caché; sin `long tasks` > 50 ms durante la reproducción (medir con `performance.getEntriesByType('longtask')` vía `javascript_tool`). Commit: `perf(web): caché de replay en el SW, OffscreenCanvas y presupuesto de rendimiento`.

---

## Criterio de "listo" de la Fase 4

- [ ] Carrera 2025 real: carpeta de replay < 10 MB comprimida; manifest válido; chunks inmutables detrás de nginx/Cloudflare.
- [ ] Player fluido (≥ 55 fps sin throttling, ≥ 30 fps con CPU 4×) en el navegador interno con preset móvil; sin scroll horizontal; controles táctiles.
- [ ] Tests de codec (Python y TS) sobre la misma fixture; truncado y magic inválido manejados; versiones y limpieza probadas.
- [ ] Correcciones §4.4 verificadas en el replay: categorías por escalón, abandonos congelados con `OUT`, posiciones oficiales, `dist` dentro de la vuelta.
- [ ] `replay_build` se encola solo después de cada ingesta de R/S (Fase 3) y aparece en el admin.
