# Fase 5 — En vivo (OpenF1 real-time → Redis → WebSocket): plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** Durante una sesión, alimentar el mismo player de la Fase 4 con `Frame`s en tiempo real desde OpenF1 (suscripción €9,90/mes), con reconexión automática, y mostrar "tu predicción vs. el orden actual" con puntos provisionales. Sin suscripción, la pantalla "En vivo" muestra la cuenta regresiva y el timing post-sesión.

**Arquitectura:** Servicio `live-ingestor` (`python -m app.live`): una sola conexión MQTT a OpenF1 (el token nunca llega al cliente), normaliza los mensajes a `Frame` a 4 Hz y los publica en Redis (`XADD live:{session_id}` con `MAXLEN ~ 7200` + `PUBLISH live:{session_id}`). La API abre **una** suscripción Redis por proceso y hace fan-out por WebSocket `/api/live/{sessionId}` a los clientes autenticados, con ping cada 30 s (Cloudflare corta a ~100 s). El cliente reutiliza el store y el `TrackCanvas` del replay en `mode: 'live'`, con un buffer de 3 s. Al terminar la sesión, la ingesta normal de la Fase 3 genera el replay; el stream de Redis expira a las 2 h.

**Tech Stack:** Redis 7 (servicio de Easypanel), `redis` 8 (asyncio), `paho-mqtt` 2.1 (o `aiomqtt`), FastAPI WebSocket, `fakeredis` en tests; web: `WebSocket` nativo con backoff exponencial.

**Spec:** `propuesta.md` §2.4, §3 (Redis, api WS), §4.1 (fila En vivo), §4.3 ("En vivo"), §5 (restricción real y recomendación), §7 (En vivo), §8 (`WS /api/live/{sessionId}`), §10 fila "5". **Plan maestro:** §1 D3, §3.1 (WebSocket).

## Restricciones globales

- OpenF1 real-time: REST/MQTT/WS entre 30 min antes y 30 min después de la sesión; hasta 10 conexiones; ~3 s de latencia; telemetría a 3,7 Hz; CC BY-NC-SA 4.0. Credenciales solo en el `live-ingestor` (`OPENF1_USERNAME`, `OPENF1_PASSWORD`).
- Feature flag `LIVE_ENABLED` (default `false`): con `false` la API responde 404 en el WS y la web muestra el modo "sin vivo".
- WS: auth por cookie en el upgrade; `Origin` validado; máximo 2 conexiones por usuario; ping/pong 30 s; cierre 4401 si el access token expira (el cliente refresca y reconecta).
- Mismo contrato `Frame` que el replay.

## Foco de revisión

1. **Desconexión de Cloudflare a los ~100 s** sin tráfico: ping cada 30 s desde el servidor y `pong` del cliente; test T3 con un servidor WS simulado que cuenta pings.
2. **Pérdida de la conexión MQTT a mitad de sesión:** el ingestor reconecta con backoff (1, 2, 4… 60 s) y repone estado desde REST (`position`, `intervals`, `stints` con `session_key=latest`) antes de seguir. Test T2 (`test_resync_after_reconnect`).
3. **Dos sesiones el mismo día** (SQ y S, o Q después de FP3): `session_id` activo se resuelve por `sessions.starts_at ± duración + 30 min`; el stream se nombra por `session_id`, nunca por `latest`. Test T2.
4. **Access token que expira mientras se mira la sesión** (15 min): el servidor cierra 4401; el cliente hace `POST /api/auth/refresh` y reconecta sin perder más de 3 s (buffer). Test T4 (Playwright: forzar expiración con `ACCESS_TOKEN_MINUTES=1` en el entorno e2e).
5. **"Tu predicción vs. ahora" con piloto que abandonó**: queda fuera del orden actual (sin puntos), igual que al final. Test T5.

---

### Tarea 1: Redis, modelos de estado en vivo y configuración

**Archivos:**
- Modificar: `apps/api/pyproject.toml` (`redis>=8.1,<9`, `paho-mqtt>=2.1,<3`), `app/config.py` (`live_enabled: bool = False`, `redis_url: str | None`, `openf1_username`, `openf1_password`, `openf1_mqtt_host="mqtt.openf1.org"`, `openf1_mqtt_port=8883`), `infra/docker-compose.dev.yml` (servicio `redis:7-alpine`), `infra/easypanel.md` (servicio Redis interno, `live-ingestor` con `command: python -m app.live`, límite 512 MB)
- Crear: `app/live/__init__.py`, `app/live/state.py` (`LiveState`: último `Frame` parcial por piloto + metadatos; `apply_message(topic, payload) -> None`; `snapshot(t_ms) -> Frame`)
- Test: `tests/live/test_state.py`

**Interfaces:**
- `LiveState(session_id, drivers_by_number: dict[int, DriverInfo], layout: Layout)` mantiene por piloto `x, y, z, speed, rpm, gear, throttle, brake, drs, position, gap_to_leader, interval, lap, tyre, tyre_life, in_pit, out, last_seen_ms`; `track_status`; `weather`; `apply_message(kind: str, item: dict)` para `location`, `car_data`, `position`, `intervals`, `laps`, `stints`, `pit`, `race_control`, `weather`, `session_result`; `snapshot(now_ms) -> Frame` (`dist`/`relDist` por proyección KD-tree sobre la polilínea del layout, port de `_project_to_reference`; `out=True` si `now_ms - last_seen_ms > 60 s` o `session_result` lo marca `dnf`).

- [ ] **Paso 1: Tests (fallan primero)**

```python
def test_apply_location_and_car_data_build_frame(layout_fixture) -> None:
    st = LiveState(1, {1: DriverInfo("VER", "#3671C6")}, layout_fixture)
    st.apply_message("location", {"driver_number": 1, "x": 1200.0, "y": -300.0, "z": 0, "date": "2026-03-07T05:00:00.000Z"})
    st.apply_message("car_data", {"driver_number": 1, "speed": 280, "rpm": 11000, "n_gear": 7, "throttle": 100, "brake": 0, "drs": 12, "date": "2026-03-07T05:00:00.200Z"})
    st.apply_message("position", {"driver_number": 1, "position": 2, "date": "2026-03-07T05:00:00.000Z"})
    f = st.snapshot(now_ms=st.t_ms("2026-03-07T05:00:00.250Z"))
    d = f["drivers"]["VER"]
    assert d["speed"] == 280 and d["gear"] == 7 and d["drs"] == 12 and d["position"] == 2 and 0 <= d["relDist"] <= 1

def test_driver_silent_for_60s_is_out(layout_fixture) -> None: ...
def test_intervals_lapped_string(layout_fixture) -> None:
    # "+1 LAP" → gapToLeader None y lapsDown 1
    ...
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(live): estado en vivo y normalización OpenF1 → Frame`.

---

### Tarea 2: Ingestor MQTT → Redis con resincronización

**Archivos:**
- Crear: `app/live/__main__.py`, `app/live/ingestor.py`, `app/live/openf1_mqtt.py`
- Test: `tests/live/test_ingestor.py` (MQTT simulado por una cola asyncio; `fakeredis.aioredis`)

**Interfaces:**
- `find_active_session(db, now) -> Session | None` (sesión con `starts_at - 30 min <= now <= starts_at + duration_min + 30 min`, prioridad a la más cercana a `starts_at`).
- `Openf1Mqtt(host, port, username, password, on_message: Callable[[str, dict], None])` con `connect()`, `subscribe(topics)`, reconexión con backoff; los **nombres de tópicos** se toman de la guía "Streaming live data" de OpenF1 (`openf1.org/auth.html`) al ejecutar esta tarea y se fijan en `OPENF1_TOPICS` (`config.py`); por defecto se suscribe a `v1/location`, `v1/car_data`, `v1/position`, `v1/intervals`, `v1/laps`, `v1/stints`, `v1/pit`, `v1/race_control`, `v1/weather`, `v1/session_result` y se verifica en la primera sesión real.
- `Ingestor(redis, state_factory, mqtt, rest: OpenF1Client)`: al conectar hace `resync()` (REST `position`, `intervals`, `stints`, `laps?lap_number>=…` con `session_key=latest`), luego cada 250 ms `XADD live:{session_id} * frame=<json>` (`MAXLEN ~ 7200`) y `PUBLISH live:{session_id}`; escribe `SET live:active {session_id}` con TTL 60 s renovado; al finalizar la ventana, `EXPIRE live:{session_id} 7200` y termina.
- `python -m app.live`: bucle que espera a `find_active_session` (cada 60 s) y lanza el ingestor; si `LIVE_ENABLED=false` sale con un log.

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_ingestor_publishes_frames_at_4hz(fake_redis, fake_mqtt, state_factory) -> None:
    ing = Ingestor(fake_redis, state_factory, fake_mqtt, rest=FakeRest())
    task = asyncio.create_task(ing.run(session_id=5, until_ms=2_000))
    await fake_mqtt.emit("v1/location", {...}); await asyncio.sleep(1.1)
    task.cancel()
    assert 3 <= await fake_redis.xlen("live:5") <= 5

async def test_resync_after_reconnect(fake_redis, fake_mqtt, state_factory) -> None:
    rest = FakeRest(position=[{"driver_number": 1, "position": 3}])
    ing = Ingestor(fake_redis, state_factory, fake_mqtt, rest=rest)
    await fake_mqtt.drop(); await ing.on_reconnect()
    assert rest.calls["position"] == 1 and ing.state.drivers[1].position == 3

async def test_two_sessions_same_day_pick_nearest(db) -> None: ...
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(live): ingestor OpenF1 MQTT → Redis con resincronización y ventana de sesión`.

---

### Tarea 3: WebSocket `/api/live/{sessionId}` con fan-out

**Archivos:**
- Crear: `app/live/ws.py`, `app/routers/live.py`
- Test: `tests/live/test_ws.py` (`fakeredis` + `httpx_ws` o el `TestClient` de Starlette para WS)

**Interfaces:**
- `GET /api/live/status` → `{enabled, active: {session_id, event, type, starts_at} | None, next: NextSessionOut}` (`public_cache(15)`).
- `WS /api/live/{session_id}`: requisitos → cookie válida (`decode_access_token`), `Origin` ∈ `allowed_origins`, `live_enabled`, sesión activa (`live:active == session_id`), ≤ 2 conexiones por usuario (contador en memoria del proceso). Mensajes servidor→cliente: `{"type":"init","sessionId","drivers","track","totalLaps","buffer":[Frame×12]}` (últimos 3 s del stream), `{"type":"frame","frame":Frame}`, `{"type":"status","state":"waiting"|"live"|"ended"}`, `{"type":"ping","t"}`; cliente→servidor: `{"type":"pong"}`. Cierres: `4401` token expirado/inválido, `4403` origin/forbidden, `4404` sin sesión activa, `4429` demasiadas conexiones.
- `LiveHub` (singleton por proceso): una tarea `SUBSCRIBE live:{id}` por sesión activa; `broadcast(frame)` a los sockets suscriptos; ping cada 30 s; desconecta a quien no responde `pong` en 10 s.
- `GET /api/live/{session_id}/my-prediction-vs-now` (auth): construye `EventResults` parcial desde el último `Frame` (`race_order` por `position` de pilotos no `out`), `pole` de los resultados de Q, `fastest_lap` provisional desde `laps` ingeridas en vivo (si hay), `dotd=None`; corre `get_ruleset(year).score_prediction` → `{provisional_points, items[], order: [{code, position, predicted_position}]}`. `public_cache(0)`; se recalcula a pedido (el cliente lo pide cada 10 s).

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_ws_requires_cookie_and_origin(ws_client) -> None: ...
async def test_ws_sends_init_then_frames_and_pings(ws_client, fake_redis) -> None:
    async with ws_client.websocket_connect("/api/live/5", headers={"Origin": "http://localhost:5173"}) as ws:
        init = await ws.receive_json(); assert init["type"] == "init" and len(init["buffer"]) <= 12
        await fake_redis.publish("live:5", json.dumps(frame_fixture)); msg = await ws.receive_json(); assert msg["type"] == "frame"
        hub.ping_interval = 0.05; await asyncio.sleep(0.1); assert (await ws.receive_json())["type"] == "ping"

async def test_ws_closes_4401_on_expired_token(ws_client) -> None: ...
async def test_prediction_vs_now_excludes_out_drivers(client, ...) -> None: ...
```

- [ ] **Paso 2: Implementar y commit**

Commit: `feat(api): WebSocket en vivo con fan-out desde Redis, ping 30 s y predicción vs. ahora`.

---

### Tarea 4: Web — pantalla "En vivo" reutilizando el player

**Archivos:**
- Crear: `src/features/live/LivePage.tsx` (`/en-vivo`), `src/features/live/useLiveSocket.ts` (conecta, parsea `init`/`frame`/`status`/`ping`→`pong`, backoff 1–30 s, en `4401` llama `POST /api/auth/refresh` y reconecta; expone `latency`), `src/features/live/LiveBanner.tsx` (estado: "Esperando sesión", "EN VIVO", "Sesión terminada; el replay estará disponible pronto"), `src/features/live/PredictionVsNow.tsx` (lista con tu posición predicha vs actual, puntos provisionales, se refresca cada 10 s)
- Modificar: `src/features/replay/store.ts` (`mode: 'live'`: `pushFrame(frame)`, `tMs` sigue a `latestMs - 3000`; el seek se limita al buffer), `TrackCanvas`/`TimingTower` (sin cambios de API), `Controls.tsx` (en vivo: oculta velocidad, muestra "EN VIVO" y botón "Ir al presente"), `navItems.ts` (ítem "En vivo" visible solo si `status.enabled`), `src/i18n/es.ts`
- Test: `tests/live/useLiveSocket.test.ts` (reconexión con backoff y refresh en 4401, con `vitest` y un `WebSocket` simulado), `e2e/live.spec.ts` (con un ingestor falso que publica frames de la fixture en Redis: `scripts/fake-live.py`)

- [ ] **Paso 1: Tests, implementación, verificación en navegador, commit**

Verificación en navegador interno con `scripts/fake-live.py` (reproduce el replay de Bahréin 2025 en Redis a 4 Hz como si fuera en vivo):
1. `/en-vivo` muestra "EN VIVO", el mapa se mueve, tower con intervalos, latencia visible ≈ 3 s.
2. Móvil: mismo layout del replay; banner y panel "Tu predicción vs. ahora" como acordeón.
3. Cortar el ingestor 20 s y reanudar: el banner pasa a "Reconectando…" y vuelve sin recargar.
4. Expirar el token (`ACCESS_TOKEN_MINUTES=1` en el entorno dev): el socket se cierra con 4401, se refresca y reconecta solo.
5. `read_network_requests urlPattern: /api/live` → un solo WS abierto por pestaña; `read_console_messages onlyErrors` vacío.

Commit: `feat(web): pantalla En vivo con reconexión automática y predicción vs. ahora`.

---

### Tarea 5: Prueba en sesión real y operación

**Archivos:**
- Modificar: `infra/easypanel.md` (checklist pre-sesión: credenciales OpenF1 en `live-ingestor`, `LIVE_ENABLED=true` en api y web, Redis sano, Cloudflare WebSockets ON), `apps/web/src/features/admin/AdminPage.tsx` (tab "En vivo": estado del ingestor, frames/s, clientes conectados, botón "Forzar resync")
- Crear: `app/routers/admin_live.py` (`GET /api/admin/live/status`, `POST /api/admin/live/resync`)

- [ ] **Paso 1: Contratar OpenF1 (decisión D3), configurar y probar en una FP real**

Criterio: una FP completa sin cortes visibles; reconexión automática probada desconectando el ingestor 1 min; RAM del ingestor < 300 MB; CPU de la API < 30 % con 20 clientes (probar con `scripts/ws-load.py` abriendo 20 sockets).

Commit: `docs(infra): operación del en vivo y panel de estado`.

---

## Criterio de "listo" de la Fase 5

- [ ] Prueba en una sesión real (FP) sin cortes; reconexión automática del cliente y del ingestor verificadas.
- [ ] Con `LIVE_ENABLED=false` la app funciona igual que antes (cuenta regresiva + timing post-sesión).
- [ ] El token de OpenF1 nunca sale del `live-ingestor` (grep en `apps/web` y en respuestas de la API).
- [ ] Pantalla verificada en navegador interno en móvil y desktop con el ingestor falso.
