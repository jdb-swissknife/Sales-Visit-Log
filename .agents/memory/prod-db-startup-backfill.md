---
name: Production DB self-heal on deploy
description: Why production data fixes need a startup backfill + redeploy, not a direct prod write
---

# Production DB self-heal on deploy

In this project (OutreachLog / sales-outreach), the **production database is a
separate instance from the dev database**. Schema (DDL) is auto-applied at
publish time, but **data is not copied** from dev to prod.

## The trap
Background geocoding only fires inside POST/PUT business API handlers
(`geocodeInBackground` in routes/businesses.ts). Seeded rows never pass through
those handlers, so a freshly seeded prod DB has addresses but **null
coordinates** → map shows "N businesses not geocoded". Dev only looked fine
because the one-off script `pnpm --filter @workspace/scripts run geocode` had
been run manually against dev — that script was never run against prod.

## The fix pattern
Add a **data-only** (DML) background backfill that runs on server startup after
seeding: select rows with address-but-null-latitude, geocode, update. It is
idempotent (already-geocoded rows are skipped) and non-blocking (runs after
`app.listen`, wrapped in try/catch, per-row try/catch).

**Why this is allowed:** the database skill bans **startup-time DDL / custom prod
migration scripts**, but this is pure DML (populating data), which is fine.

**Why redeploy is required:** prod runs the *deployed* build, and we cannot write
to the prod DB directly (database skill allows only read-only prod queries). So
prod self-heals only after the user **redeploys** with this code.

## Critical: do NOT rely on live geocoding at startup in production
A first attempt geocoded via live network calls (Census/Nominatim) on startup.
It worked in dev only because dev had been pre-geocoded by the one-off script, so
the backfill faced just the 5 hard ones. In production it faced all 100 fresh and
resolved only ~3 — startup live geocoding is too slow (1.1s/row) and gets
interrupted by autoscale/restarts.

**The reliable fix: bake the answers in.** Extract the known-good coordinates
from the dev DB (where they resolved successfully) into a committed lookup file
(`artifacts/api-server/src/lib/geocode-coords.ts`, `KNOWN_COORDS` keyed by exact
address string). Backfill does Pass 1 = instant DB updates from the lookup (no
network), Pass 2 = live geocode only for addresses not in the lookup. Deterministic
and fast. **Why:** address strings are identical across dev/prod because both come
from the same `lib/db/src/seed.ts` array, so an exact-string key matches.

## Gotchas
- Exact-string key means seed/address edits silently drop a row to the slow live
  path. If you change seed addresses, regenerate `KNOWN_COORDS` from a freshly
  geocoded dev DB.
- Throttle live fallback to OpenStreetMap Nominatim's 1 req/sec policy
  (sleep ~1100ms/row); `geocodeAddress` falls back Census → Nominatim.
- A few addresses are genuinely unresolvable (5/100 here) and will always fail —
  expected, not a bug.
