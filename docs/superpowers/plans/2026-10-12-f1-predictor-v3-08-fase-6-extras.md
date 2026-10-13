# Fase 6 — Extras: neumáticos (estimado), push PWA, noticias RSS, i18n: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`). Las cuatro tareas son independientes entre sí y pueden ir en PRs separados en cualquier orden.

**Objetivo:** (1) Portar el modelo bayesiano de degradación de neumáticos con las correcciones de §4.4 y mostrar la salud del neumático como **estimada** en el replay y el análisis; (2) notificaciones push de la PWA ("cerrá tu predicción en 1 h"); (3) noticias por RSS cada 30 min en Inicio; (4) i18n de la UI (es/en) sin tocar componentes.

**Arquitectura:** El modelo de neumáticos corre en el worker como paso opcional de la ingesta (`tyre_model_session`) y escribe `tyre_health` por vuelta y piloto en `laps` (columna `tyre_health_est`) y en el manifest del replay (`tyreHealth: {code: [por vuelta]}`). Push con VAPID (`pywebpush`) y suscripciones en Postgres; un job del worker cada 5 min busca eventos cuya qualy cierra en 55–65 min. RSS con `feedparser` y deduplicación por hash de URL. i18n: `t()` lee el idioma activo de un store; `en.ts` tiene las mismas claves que `es.ts` (test de paridad).

**Tech Stack:** numpy/scipy (filtro de Kalman y ajuste hacia priors, sin PyMC), `pywebpush`, `feedparser`, `vite-plugin-pwa` (SW con handler `push`), Zustand (idioma).

**Spec:** `propuesta.md` §1 (fila `bayesian_tyre_model.py`), §4.1 (Noticias), §4.4 (fila del modelo de neumáticos), §7 (Replay: "salud del neumático (Fase 6, estimada)"), §10 fila "6". **Plan maestro:** §3.4.

## Restricciones globales

- El modelo se muestra siempre con la etiqueta "estimado"; nunca como dato oficial.
- Correcciones obligatorias: la condición de pista **no** sale de una columna `TrackCondition` (no existe en FastF1) sino del clima (`rainfall`) y de los compuestos en pista (INTERMEDIATE/WET); `latent_pace` se ajusta con el ritmo base de la sesión (`f1data.laps.base_pace`); `max_tyre_life` se calcula por compuesto a partir de los stints históricos del mismo circuito (p95 de `lap_end - lap_start`), nunca queda en 30 fijo.
- Push solo con consentimiento explícito en Perfil; se puede desactivar; nunca más de 1 notificación por evento y usuario.
- RSS: solo título, enlace, fuente, fecha y resumen corto (≤ 300 caracteres); sin reproducir el cuerpo del artículo.
- i18n: cero strings inline (ya garantizado desde Fase 0); `es` por defecto.

## Foco de revisión

1. **Sesión mojada**: con `rainfall=true` o compuestos I/W, el modelo usa la curva "wet" y el IC se ensancha; no debe predecir "100 % salud" para intermedios de 30 vueltas. Test T1.
2. **Suscripción push caducada** (`410 Gone` del push service): se borra la fila y no se reintenta. Test T2.
3. **Usuario con predicción ya guardada**: no recibe el aviso de cierre (solo quien no guardó, salvo que active "avisarme igual"). Test T2.
4. **Feed RSS caído o con XML inválido**: el job registra el error en `ingest_runs` y sigue con los otros feeds; Inicio muestra las últimas noticias disponibles. Test T3.
5. **Clave faltante en `en.ts`**: el test de paridad falla en CI antes de llegar a producción. Test T4.

---

### Tarea 1: Modelo de degradación de neumáticos (port corregido)

**Archivos:**
- Crear: `f1data/tyre_model.py` (port de `src/bayesian_tyre_model.py` + `src/tyre_degradation_integration.py` con cabecera de atribución), `app/worker/jobs/tyre_model.py`, migración `0008_tyre_health` (`laps.tyre_health_est numeric(5,2)`, `laps.tyre_pred_next_ms int`, `laps.tyre_pred_ci_ms int`)
- Modificar: `app/worker/jobs/fastf1_ingest.py` (encola `tyre_model_session` tras `complete`), `app/worker/jobs/replay_build.py` (agrega `tyreHealth` al manifest si existe), `app/routers/analysis.py` (`GET /api/sessions/{id}/tyres?driver=` → `[{lap, compound, tyre_life, health_est, pred_next_ms, ci_ms}]`)
- Web: `src/features/replay/DriverPanel.tsx` (barra "Neumático (estimado)"), `src/features/analysis/charts/TyreHealthChart.tsx` (tab Estrategia: línea de salud por stint con banda de IC 95 %)
- Test: `tests/f1data/test_tyre_model.py`, `tests/test_tyre_job.py`

**Interfaces:**
- `TrackCondition = Literal["dry", "damp", "wet"]`; `infer_track_condition(weather: pd.DataFrame, laps: pd.DataFrame, t_ms: int) -> TrackCondition` (`wet` si `rainfall` en la última muestra o ≥ 50 % de los autos en I/W; `damp` si ≥ 20 %).
- `compound_max_life(db_stints: pd.DataFrame, compound: str, default: dict[str, int] = {"SOFT": 25, "MEDIUM": 35, "HARD": 45, "INTERMEDIATE": 30, "WET": 25}) -> int` (p95 de largo de stint por compuesto en ese circuito; fallback a `default`).
- `TyreModel(compound: str, max_life: int, latent_pace_ms: float, condition: TrackCondition)` con `update(lap_time_ms: int, tyre_age: int, flags: LapFlags) -> None` (ignora vueltas de pit, outliers y bajo SC/VSC) y `estimate() -> TyreEstimate(health_pct: float, pred_next_ms: int, ci95_ms: int)`; port del filtro de Kalman y del ajuste hacia priors de upstream, con `latent_pace` inicializado desde `base_pace` y actualizado con las primeras 3 vueltas limpias del stint.
- `estimate_session(laps: pd.DataFrame, weather: pd.DataFrame, stints_hist: pd.DataFrame) -> pd.DataFrame[driver, number, health_est, pred_next_ms, ci_ms]`.

- [ ] **Paso 1: Tests (fallan primero)**

```python
def test_dry_soft_degrades_monotonically(clean_stint_laps_soft) -> None:
    m = TyreModel("SOFT", max_life=25, latent_pace_ms=92_000, condition="dry")
    healths = []
    for lap in clean_stint_laps_soft: m.update(lap.time_ms, lap.tyre_life, lap.flags); healths.append(m.estimate().health_pct)
    assert healths[0] > 90 and healths[-1] < 60 and all(a >= b - 2 for a, b in zip(healths, healths[1:]))

def test_wet_condition_widens_ci_and_caps_health(inter_stint_laps, wet_weather) -> None:
    cond = infer_track_condition(wet_weather, inter_stint_laps, t_ms=inter_stint_laps.lap_start_ms.max())
    assert cond == "wet"
    m = TyreModel("INTERMEDIATE", max_life=30, latent_pace_ms=105_000, condition=cond)
    for lap in inter_stint_laps: m.update(lap.time_ms, lap.tyre_life, lap.flags)
    e = m.estimate(); assert e.ci95_ms > 800 and e.health_pct < 95

def test_max_life_from_history_not_fixed_30(stints_hist_bahrain) -> None:
    assert compound_max_life(stints_hist_bahrain, "HARD") > 30 and compound_max_life(stints_hist_bahrain, "SOFT") < 30

def test_latent_pace_adapts_to_session(clean_stint_laps_soft) -> None:
    fast = TyreModel("SOFT", 25, latent_pace_ms=80_000, condition="dry"); slow = TyreModel("SOFT", 25, latent_pace_ms=100_000, condition="dry")
    for lap in clean_stint_laps_soft[:3]: fast.update(lap.time_ms, lap.tyre_life, lap.flags); slow.update(lap.time_ms, lap.tyre_life, lap.flags)
    assert abs(fast.latent_pace_ms - slow.latent_pace_ms) < 1500     # ambos convergen al ritmo real (~92 s)
```

- [ ] **Paso 2: Implementar, correr sobre Bahréin 2025 R, verificar en navegador (panel del piloto muestra "Neumático: 72 % (estimado)" y el chart de salud con banda), commit**

Commit: `feat(f1data): modelo de degradación de neumáticos corregido y mostrado como estimado`.

---

### Tarea 2: Notificaciones push de la PWA

**Archivos:**
- Crear: `app/models/push.py` (`PushSubscription(id, user_id, endpoint UNIQUE, p256dh, auth, user_agent, created_at, last_error)`), migración `0009_push`, `app/routers/push.py` (`GET /api/push/vapid-public-key`, `POST /api/push/subscribe {endpoint, keys:{p256dh, auth}}`, `DELETE /api/push/subscribe {endpoint}`, `PATCH /api/me/notifications {prediction_reminder: bool, remind_even_if_saved: bool}` + columnas en `profiles`), `app/services/push.py` (`send(sub, payload) -> None`, borra en 404/410), `app/worker/jobs/push_reminders.py` (cada 5 min: eventos con `lock_times().main ∈ [now+55m, now+65m]` → usuarios con `prediction_reminder` y sin predicción (o con `remind_even_if_saved`) y sin fila en `push_sent(user_id, event_id)` → envía `{"title":"Cerrá tu predicción","body":"La qualy del GP de … empieza en 1 h.","url":"/predicciones/{id}"}` y registra `push_sent`)
- Modificar: `apps/web/vite.config.ts` (`strategies: 'injectManifest'`, `srcDir: 'src/pwa'`, `filename: 'sw.ts'`), crear `src/pwa/sw.ts` (precaching de workbox + `self.addEventListener('push', …)` que muestra la notificación y `notificationclick` que abre `url`), `src/features/profile/NotificationsSection.tsx` (toggle con `Notification.requestPermission()` y `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`), `.env.example` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:...`; generar con `uv run python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print(v.public_key_b64, v.private_key_b64)"`), `pyproject.toml` (`pywebpush`)
- Test: `tests/test_push_reminders.py`, `tests/test_push_service.py` (push service simulado que responde 201 y luego 410)

- [ ] **Paso 1: Tests (fallan primero)**

```python
async def test_reminder_only_for_users_without_prediction_in_window(db, seeded_event_closing_in_60m, subs) -> None:
    sent = await send_reminders(db, now=datetime.now(UTC), sender=fake_sender)
    assert {s.user_id for s in sent} == {subs["dario"].user_id}            # ana ya guardó, dario no
    assert await send_reminders(db, now=datetime.now(UTC) + timedelta(minutes=1), sender=fake_sender) == []   # no repite

async def test_gone_subscription_is_deleted(db, sub) -> None:
    await push_send(db, sub, {"title": "x"}, transport=lambda *a, **k: FakeResp(410))
    assert await db.get(PushSubscription, sub.id) is None
```

- [ ] **Paso 2: Implementar, verificar en navegador interno (Perfil → activar notificaciones → aceptar permiso → `scripts/push-test.py` envía una de prueba → aparece la notificación del sistema; click abre `/predicciones/:id`), commit**

Commit: `feat: notificaciones push de la PWA para el cierre de predicciones`.

---

### Tarea 3: Noticias RSS

**Archivos:**
- Crear: `app/models/news.py` (`NewsItem(id, source, title, url UNIQUE, url_hash, published_at, summary, image_url, created_at)`), migración `0010_news`, `app/services/rss.py` (`FEEDS = [("Formula1.com", "https://www.formula1.com/en/latest/all.xml"), ("Motorsport", "https://www.motorsport.com/rss/f1/news/"), ("Autosport", "https://www.autosport.com/rss/f1/news/")]`; `fetch_feed(http, url) -> list[dict]` con `feedparser`, `timeout 15 s`, `User-Agent` propio, resumen truncado a 300 caracteres sin HTML), `app/worker/jobs/rss.py` (cada 30 min; un `ingest_runs` por feed; `ON CONFLICT (url) DO NOTHING`; conserva 500 ítems), `app/routers/news.py` (`GET /api/news?limit=20` `public_cache(300)`)
- Web: `src/features/home/NewsCard.tsx` (lista de 5 con fuente, hora relativa "hace 2 h", enlace externo `rel="noopener"`, imagen opcional `loading="lazy"` con tamaño fijo), `src/features/news/NewsPage.tsx` (`/noticias`, paginada)
- Test: `tests/test_rss.py` (fixture XML válido e inválido; dedupe), `tests/NewsCard.test.tsx`

- [ ] **Paso 1: Tests, implementación, verificación en navegador (Inicio muestra noticias reales; `/noticias` en móvil sin scroll horizontal; imágenes con `width/height`), commit**

Commit: `feat: noticias por RSS cada 30 minutos en Inicio`.

---

### Tarea 4: i18n (es/en)

**Archivos:**
- Crear: `src/i18n/en.ts` (mismas claves que `es.ts`), `src/i18n/store.ts` (Zustand `lang: 'es'|'en'`, persistido en `localStorage` y en `profiles.lang` si hay sesión), modificar `src/i18n/t.ts` (lee el store; `useT()` hook para re-render al cambiar), `src/features/profile/LanguageSelect.tsx`, `index.html` (`lang` se actualiza con `document.documentElement.lang`)
- Backend: `profiles.lang` (migración `0011_lang`), `PATCH /api/me/profile {lang}`; la API sigue respondiendo errores en español (los `code` permiten traducir en la UI: `src/i18n/apiErrors.ts` mapea `code` → clave).
- Test: `tests/i18n/parity.test.ts` (`Object.keys(es)` igual a `Object.keys(en)` y ningún valor vacío), `tests/i18n/t.test.ts` (cambio de idioma re-renderiza)

- [ ] **Paso 1: Tests, traducción completa de `en.ts`, verificación en navegador (Perfil → English → toda la UI cambia, incluidos BottomNav y mensajes de error de la API mapeados), commit**

Commit: `feat(web): i18n es/en con paridad de claves verificada en CI`.

---

## Criterio de "listo" de la Fase 6

- [ ] Salud del neumático visible como "estimado" en replay y análisis, con tests de las tres correcciones de §4.4.
- [ ] Push funcionando de punta a punta en el navegador interno y en un teléfono real con la PWA instalada; sin duplicados por evento.
- [ ] Noticias reales en Inicio; feeds caídos no rompen el job.
- [ ] UI completa en inglés con paridad de claves; español por defecto.
