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

## Gotchas
- Throttle to OpenStreetMap Nominatim's 1 req/sec policy (sleep ~1100ms/row);
  `geocodeAddress` falls back Census → Nominatim, so bulk runs hit Nominatim.
- A few addresses are genuinely unresolvable (5/100 here) and will always fail —
  expected, not a bug.
