#!/usr/bin/env bash
###############################################################################
# Phase 3 activation — Replit (single paste-and-run)
#
# WHAT IT DOES (ACTIVATION.md steps 1-7, automated):
#   1. copies repo-overlay/* over the clone (additive; only schema/index.ts overwrites)
#   2. patches 3 live source files (events.ts hook, routes/index.ts, app.ts) — idempotent
#   3. typechecks + Drizzle-pushes the R1 schema to Neon
#   4. runs the crypto selftest + the real esbuild build (matches CI baseline)
#   5. commits (and pushes only if you opt in)
#
# RUN FROM: the ROOT of a clean clone of Sales-Visit-Log `main` (Phase 2 baseline 2e15a06)
#           with the phase3-staging bundle present (default ./phase3-staging).
#
# ENV TOGGLES:
#   BUNDLE=/path/to/phase3-staging   # where the bundle lives (default ./phase3-staging)
#   SKIP_DB=1                        # skip the Drizzle push (typecheck only; no DB mutation)
#   PUSH=1                           # actually `git push` after commit (default: stop after commit)
#
# Secrets expected in Replit (already configured there per the plan):
#   DATABASE_URL, AGENT_API_KEY, HERMES_WEBHOOK_URL, HERMES_WEBHOOK_SECRET
###############################################################################
set -euo pipefail

BUNDLE="${BUNDLE:-./phase3-staging}"
OVERLAY="$BUNDLE/repo-overlay"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
say "0. sanity check (right repo + bundle present)"
for f in \
  artifacts/api-server/src/routes/businesses.ts \
  artifacts/api-server/src/routes/index.ts \
  artifacts/api-server/src/app.ts \
  artifacts/api-server/src/lib/events.ts \
  lib/db/src/schema/index.ts ; do
  [ -f "$f" ] || { echo "ERROR: '$f' missing — are you at the repo root of a clean main clone?"; exit 1; }
done
[ -d "$OVERLAY" ] || { echo "ERROR: overlay not found at '$OVERLAY'. Set BUNDLE=/path/to/phase3-staging."; exit 1; }
[ -f "$BUNDLE/selftest.mjs" ] || { echo "ERROR: '$BUNDLE/selftest.mjs' missing."; exit 1; }
echo "ok."

# ---------------------------------------------------------------------------
say "1. drop in the overlay"
cp -r "$OVERLAY"/. .
echo "overlay copied (schema/index.ts intentionally replaced to add the 4 new exports)."

# ---------------------------------------------------------------------------
say "2. patch live source files (idempotent, anchored)"
python3 - "$PWD" <<'PY'
import sys
root = sys.argv[1]

def read(p):  return open(p, encoding="utf-8").read()
def write(p,s): open(p,"w",encoding="utf-8").write(s)

# --- 2a. events.ts: capture inserted id + fire the outbound webhook (R2 hook) ---
ev = "artifacts/api-server/src/lib/events.ts"
s = read(ev)
if "fireWebhook(" in s:
    print("  [skip] events.ts already hooked")
else:
    s = s.replace(
        'import { logger } from "./logger";',
        'import { logger } from "./logger";\nimport { fireWebhook } from "./webhooks";',
        1)
    old = '''    await db.insert(eventsTable).values({
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      businessId: input.businessId ?? null,
      visitId: input.visitId ?? null,
      payload: input.payload ?? null,
      source: input.source ?? "server",
    });'''
    new = '''    const [row] = await db
      .insert(eventsTable)
      .values({
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        businessId: input.businessId ?? null,
        visitId: input.visitId ?? null,
        payload: input.payload ?? null,
        source: input.source ?? "server",
      })
      .returning({ id: eventsTable.id, createdAt: eventsTable.createdAt });

    // R2: fire-and-forget outbound webhook to Hermes. Never throws; cannot break logEvent.
    fireWebhook({
      eventId: String(row.id),
      eventType: input.type,
      occurredAt: new Date(row.createdAt).toISOString(),
      businessId: input.businessId ?? null,
      data: (input.payload ?? {}) as Record<string, unknown>,
    });'''
    if old not in s:
        sys.exit("ERROR: events.ts insert block not found verbatim — apply 2a by hand (see PHASE3-PATCHES.md).")
    s = s.replace(old, new, 1)
    write(ev, s)
    print("  [ok]   events.ts hooked (returning id + fireWebhook)")

# --- 2b. routes/index.ts: register agent / suggestions / insights ---
ri = "artifacts/api-server/src/routes/index.ts"
s = read(ri)
if "agentRouter" in s:
    print("  [skip] routes/index.ts already registers R3 routers")
else:
    s = s.replace(
        'import eventsRouter from "./events";',
        'import eventsRouter from "./events";\n'
        'import agentRouter from "./agent";\n'
        'import suggestionsRouter from "./suggestions";\n'
        'import insightsRouter from "./insights";',
        1)
    s = s.replace(
        "router.use(eventsRouter);",
        'router.use(eventsRouter);\n'
        'router.use("/agent", agentRouter);          // behind requireAgentKey (internal)\n'
        'router.use("/suggestions", suggestionsRouter);\n'
        'router.use("/insights", insightsRouter);',
        1)
    write(ri, s)
    print("  [ok]   routes/index.ts registers /agent, /suggestions, /insights")

# --- 2c. app.ts: mount inbound webhook BEFORE express.json() (raw body for HMAC) ---
ap = "artifacts/api-server/src/app.ts"
s = read(ap)
if "/api/webhooks" in s:
    print("  [skip] app.ts already mounts the inbound webhook")
else:
    s = s.replace(
        'import router from "./routes";',
        'import router from "./routes";\n'
        'import webhooksInboundRouter from "./routes/webhooks-inbound";',
        1)
    anchor = "app.use(express.json());"
    if anchor not in s:
        sys.exit("ERROR: app.ts has no `app.use(express.json());` — apply 2c by hand (see PHASE3-PATCHES.md).")
    s = s.replace(
        anchor,
        '// R3 inbound receiver needs the RAW body for HMAC — must precede express.json().\n'
        'app.use("/api/webhooks", webhooksInboundRouter);\n'
        + anchor,
        1)
    write(ap, s)
    print("  [ok]   app.ts mounts /api/webhooks before express.json()")
PY

# ---------------------------------------------------------------------------
say "3. R1 — typecheck + migrate the schema"
pnpm --filter @workspace/db run typecheck
if [ "${SKIP_DB:-0}" = "1" ]; then
  echo "SKIP_DB=1 — skipping Drizzle push (no DB mutation)."
else
  echo "Pushing additive schema to Neon (4 new tables; no Phase 2 data loss)…"
  pnpm --filter @workspace/db run push
fi

# ---------------------------------------------------------------------------
say "4. R2/R3 — crypto selftest + esbuild build"
node "$BUNDLE/selftest.mjs"          # expect: 12 passed, 0 failed
# Gate matches the real ship baseline: the esbuild bundle (build.mjs) is what actually deploys.
# `pnpm -r typecheck` was STRICTER than baseline — it trips on pre-existing Phase 2 noise
# (media.ts/transcription.ts, api-zod types) that esbuild does not type-check. Build instead.
pnpm -r --if-present run build

# ---------------------------------------------------------------------------
say "5. commit"
git add -A
git status --short
git commit -m "Phase 3 (R1+R2+R3): agent/insight schema, webhook envelope+signing, agent auth, SSE bus, agent/suggestions/insights routes, signed inbound receiver"

if [ "${PUSH:-0}" = "1" ]; then
  say "5b. push"
  git push
  echo "pushed."
else
  echo
  echo "Committed locally. Review the diff, then push with:  git push"
  echo "(or re-run this script with PUSH=1 to push automatically.)"
fi

say "done — Phase 3 activated"
cat <<'SMOKE'
Smoke tests (with AGENT_API_KEY + HERMES_WEBHOOK_SECRET set, server running on $PORT):
  curl -s localhost:$PORT/api/suggestions                       # -> { "suggestions": [] }
  curl -s localhost:$PORT/api/agent/events                      # -> 401 (no Bearer)
  curl -s -H "Authorization: Bearer $AGENT_API_KEY" \
       "localhost:$PORT/api/agent/context?businessId=1"         # -> context bundle
SMOKE
