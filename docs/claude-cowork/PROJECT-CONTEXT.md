# PROJECT-CONTEXT.md — carried-over context

Hard-won context that should not get stranded when moving projects. Read the
relevant section before touching the callback cron, the map page, geocoding, or
production data.

---

## 1. Callback-reminder cron (current feature state — merged)

Status: complete and merged into `main` via PR #1
(https://github.com/jdb-swissknife/Sales-Visit-Log/pull/1), merge commit
`f4aff919921818d5274463701751ec067d03b832`.

### What landed
- Deterministic in-app callback-reminder cron: `artifacts/api-server/src/lib/callback-cron.ts`
- Wired into api-server startup: `artifacts/api-server/src/index.ts`
- DB-backed node:test coverage: `artifacts/api-server/tests/callback-cron.test.ts`
- api-server test script + `tsx` dev dependency: `artifacts/api-server/package.json`, `pnpm-lock.yaml`

### Behavior
- api-server runs an in-app deterministic callback sweep.
- Emits `callback_reminder` suggestions for due and overdue callbacks.
- Overdue → `priority = "high"`; due-today → `priority = "normal"`; future → skipped.
- Superseded callbacks skipped when a later visit exists for the same business.
- Deterministic dedupe key: `cb-due:{visitId}:{YYYY-MM-DD}` — re-running refreshes
  existing cards instead of creating duplicates.
- Suggestions get `expiresAt` = end of the configured local day; `source = "system"`.
- Records lifecycle in `agent_runs`: `queued -> running -> completed/skipped/failed`.

### Env flags
- `CALLBACK_CRON_ENABLED` — default enabled; `false` to disable.
- `CALLBACK_CRON_HOUR` — default `7`, clamped 0-23.
- `CALLBACK_CRON_TZ_OFFSET_MIN` — default `0`.

### Test suite covers
overdue → high; due-today → normal; superseded → none; future → none; run
lifecycle closes cleanly; second sweep refreshes without duplicates; no-op sweep
completes/skips cleanly. Last run: 4 passed / 0 failed / 0 skipped.

Run with: `pnpm --filter @workspace/api-server test`

---

## 2. Production DB self-heal on deploy

The **production database is a separate instance from dev**. Schema (DDL)
auto-applies at publish time, but **data is not copied** from dev to prod.

**The trap:** background geocoding only fires inside POST/PUT business handlers
(`geocodeInBackground` in `routes/businesses.ts`). Seeded rows never pass through
those handlers, so a freshly seeded prod DB has addresses but **null
coordinates** → map shows "N businesses not geocoded". Dev only looked fine
because `pnpm --filter @workspace/scripts run geocode` had been run manually
against dev; it was never run against prod.

**The fix pattern:** a **data-only (DML)** background backfill on server startup
after seeding — select rows with address-but-null-latitude, geocode, update.
Idempotent (skips already-geocoded) and non-blocking (runs after `app.listen`,
wrapped in try/catch, per-row try/catch).

- Allowed because it's pure DML; the database skill bans only startup DDL / custom
  prod migration scripts.
- Requires **redeploy**: prod runs the deployed build and we can't write to prod
  DB directly (read-only prod queries only). Prod self-heals after redeploy.

**Critical — do NOT rely on live geocoding at startup in prod.** Live calls
(Census/Nominatim) are too slow (~1.1s/row) and get interrupted by
autoscale/restarts; a first attempt resolved only ~3/100 fresh rows.

**Reliable fix — bake the answers in.** Extract known-good coordinates from the
dev DB into a committed lookup (`artifacts/api-server/src/lib/geocode-coords.ts`,
`KNOWN_COORDS` keyed by exact address string). Backfill Pass 1 = instant DB
updates from the lookup (no network); Pass 2 = live geocode only for addresses
not in the lookup. Works because address strings are identical across dev/prod
(both come from `lib/db/src/seed.ts`).

**Gotchas:** editing seed addresses silently drops a row to the slow live path —
regenerate `KNOWN_COORDS` from a freshly geocoded dev DB if you change them.
Throttle live fallback to Nominatim's 1 req/sec (~1100ms/row); `geocodeAddress`
falls back Census → Nominatim. ~5/100 addresses are genuinely unresolvable —
expected, not a bug.

---

## 3. MapLibre map robustness (sales-outreach map page)

The map page (`artifacts/sales-outreach/src/pages/map/index.tsx`) renders a
MapLibre GL map. Several failure modes make it "show nothing" even when business
data loaded fine (the legend / "N not geocoded" overlay still renders because it
is absolutely positioned, independent of the canvas).

**Failure modes guarded:**
1. **WebGL context creation fails** — `new maplibregl.Map()` *throws*; without
   try/catch in `useEffect` this crashes the component. The Replit screenshot
   sandbox has no GPU so it ALWAYS throws — handle it, don't mistake it for the
   real bug.
2. **Zero-size container at init** — `dvh` heights / mobile chrome / layout
   settling leave the canvas 0px. Fix: `map.resize()` on `load` + a
   `ResizeObserver` on the container.
3. **Style/tiles never finish loading** — map inits but `load` never fires. Fix:
   an 8s `setTimeout` that flips to the fallback if `load` hasn't fired.
4. **Container collapses to 0px height even with a real-height parent** — MapLibre
   adds `.maplibregl-map` whose bundled CSS sets `position: relative`, overriding
   an `absolute inset-0` utility (same specificity, MapLibre wins by source
   order), so `top/bottom:0` no longer size it → `clientHeight` 0. **Fix:** size
   the container with **flex-grow**, not absolute positioning. Map-page root =
   `relative flex flex-col grow min-h-0 w-full`; container = `grow min-h-0 w-full`.
   Avoid `dvh`/percentage heights up the chain — some in-app webviews (dpr=3
   mobile) collapse both `100dvh` and `height:100%`-through-flex to 0; a pure
   flex-grow chain from an `h-screen`/`100dvh`-fallback shell is what holds.

**The pattern:** wrap init in try/catch → on failure set `mapError` and render a
**usable fallback** (tappable list of located businesses that opens the same
quick-log drawer), never a blank canvas. Clean up: `clearTimeout`,
`ResizeObserver.disconnect()`, `map.remove()`.

**Why:** a field-sales app runs on varied mobile devices/browsers where WebGL or
tile loading can fail; a blank map is useless, a fallback list keeps the user
working.
