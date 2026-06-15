> **UPDATE 2026-06-14 — verified & scripted.** The two "couldn't verify" items below were checked
> against live GitHub `main` and resolved. Activation is now a single script: **`activate-replit.sh`**,
> with exact live-file edits documented in **`PHASE3-PATCHES.md`**. The hand-written step-3 hook in
> this file is SUPERSEDED by patch 2a in PHASE3-PATCHES.md (live `logEvent` returns `void` and uses an
> integer `id` — the real hook uses `.returning()`). Use the script + patches doc as the source of truth;
> the steps below remain as background narrative.

# Phase 3 — portable staging bundle

**One self-contained drop-in for the Hermes app-side rebuild (R1 + R2 + R3).** Everything here is
plain source + docs with **no dependency on the OneDrive working folder's state** — copy this
folder anywhere (a fresh clone, a new project, Replit) and activate.

Created 2026-06-13. Staged (not yet typechecked/migrated/committed) because the build shell was
down — same conditions that forced R1 to be staged. See "Why staged" at the bottom.

---

## What's in this bundle

```
phase3-staging/
  ACTIVATION.md          <- you are here (master sequence)
  REBUILD_PLAN.md        <- the full plan + locked decisions (source of truth)
  selftest.mjs           <- pure-node HMAC sign/verify + replay-window check
  repo-overlay/          <- COPY THIS INTO A CLEAN CLONE OF GitHub `main` (Phase 2)
    lib/db/src/schema/                         (R1 — additive DB schema)
      index.ts                 REPLACES existing: keeps 5 originals + adds 4 exports
      agent-runs.ts            new
      agent-suggestions.ts     new
      agent-event-receipts.ts  new
      insights.ts              new
    artifacts/api-server/src/                  (R2 — server lib)
      lib/webhook-envelope.ts  new   canonical envelope zod schema + WEBHOOK_VERSION
      lib/webhooks.ts          new   buildEnvelope + HMAC signing + send (1 retry)
      lib/suggestion-bus.ts    new   in-memory pub/sub for the suggestions SSE feed
      middlewares/agent-auth.ts new  requireAgentKey (503 unconfigured / 401 invalid)
    artifacts/api-server/src/routes/           (R3 — routes)
      agent.ts             new   agent API (behind requireAgentKey)
      suggestions.ts       new   app-facing feed: list + PATCH lifecycle + SSE
      webhooks-inbound.ts  new   signed inbound receiver (mount BEFORE express.json())
      insights.ts          new   app-facing prospect/rep insight read
      PHASE3-REGISTER.md   doc   exact lines to add to routes/index.ts + server entry
```

`repo-overlay/` mirrors the **real repo layout (no `app/` prefix)**, so activation is literally
"copy `repo-overlay/*` over a clean clone." The only file that overwrites anything is
`lib/db/src/schema/index.ts` (intended — it adds the 4 new exports to the existing 5).

---

## Activation sequence (needs a shell — Replit recommended, since DB + secrets live there)

### 0. Get the real baseline
The authoritative baseline is **GitHub `main` (Phase 2, commit `2e15a06`)** — NOT the stale
OneDrive snapshot. Clone it fresh:
```
git clone <Sales-Visit-Log repo url> phase3
cd phase3
```
Confirm the baseline: `artifacts/api-server/src/routes/` has `businesses.ts`, `events.ts`,
`visits.ts`, `media.ts`, `notes.ts`, and `lib/db/src/schema/index.ts` exists. If those aren't
there, you cloned the wrong thing — stop.

### 1. Drop in the overlay
Copy `repo-overlay/*` into the clone, preserving paths:
```
cp -r /path/to/phase3-staging/repo-overlay/* .
```

### 2. R1 — typecheck + migrate the schema
```
pnpm --filter @workspace/db run typecheck    # or: pnpm -r typecheck
pnpm --filter @workspace/db run push         # Drizzle push to Neon; needs DATABASE_URL
```
Verify the 4 new tables (`agent_runs`, `agent_suggestions`, `agent_event_receipts`, `insights`)
appear with **no diffs flagged against existing Phase 2 tables** (additive only — no Phase 2 data loss).

### 3. R2 — wire the outbound hook
The R2 lib files are additive, but the outbound webhook must be hooked into the central emit
point `artifacts/api-server/src/lib/events.ts`. At the end of `logEvent(...)` (after the event row
is persisted) add:
```ts
import { fireWebhook } from "./webhooks";
// ...once the event is saved and you have its fields:
fireWebhook({
  eventId,                 // the event's ULID/text id
  eventType,               // e.g. "visit.created"
  occurredAt,              // ISO string; omit to default to now()
  repId: repId ?? null,    // integer or null
  businessId: businessId ?? null,
  correlationId: correlationId ?? null,
  data,                    // { aiStructured } on media.transcribed; { daySummary } on day.ended
});
```
`fireWebhook` is fire-and-forget and swallows all errors, so it cannot break `logEvent`.
**Read the live `events.ts` and map your actual variable names onto these fields** — this is the
one spot the staged code couldn't be verified against the real file (shell + GitHub both down at
staging time).

### 4. R2 — typecheck + crypto selftest
```
pnpm --filter @workspace/api-server run typecheck   # or: pnpm -r typecheck
node /path/to/phase3-staging/selftest.mjs            # expect: 12 passed, 0 failed
```

### 5. Commit + push (Phase 3 has NEVER been in version control — this is the whole point)
```
git add lib/db/src/schema artifacts/api-server/src/lib artifacts/api-server/src/middlewares \
        artifacts/api-server/src/lib/events.ts
git commit -m "Phase 3 R1+R2: agent/insight schema, webhook envelope, signing, agent auth, SSE bus"
git push
```

### 6. R3 — register the routes
The four route files are in the overlay. Register them by hand (don't blind-overwrite the live
`routes/index.ts`) following **`repo-overlay/artifacts/api-server/src/routes/PHASE3-REGISTER.md`**:
- `agent`, `suggestions`, `insights` → mount in `routes/index.ts`.
- `webhooks-inbound` → mount in the **server entry BEFORE `express.json()`** (raw body for HMAC).

Then reconcile the two `PHASE2-DEP` blocks in `agent.ts` (`GET /events`, `GET /context`) against
the live Phase 2 `events`/`businesses`/`visits`/`notes` tables — these are the only R3 parts that
touch tables not seen at staging. Everything else (writes + suggestions + insights + inbound) runs
on R1/R2 and needs no Phase 2 table knowledge.

```
pnpm -r typecheck
# smoke (secrets set): curl /api/suggestions ; curl -H "Authorization: Bearer $AGENT_API_KEY" /api/agent/context?businessId=1
```

### 7. Commit + push everything
Add the R3 route files and the edited `routes/index.ts` + server entry to the same commit
sequence in step 5 (or a follow-up `R3:` commit). Then proceed to R4 (frontend) / R5 (tests).

---

## Locked decisions (full detail in REBUILD_PLAN.md)
- Integer serial PKs everywhere; app DB authoritative. ULIDs only in text fields (`eventId`, `externalId`).
- `WEBHOOK_VERSION = "2026-06-12"`. Outbound stamps it; inbound permissive on version.
- Priority stored `low|normal|high|urgent`; contract `medium` normalized to `normal` on input (R3 route).
- Insights keep `summary`/`score` naming, expanded additively; original `(businessId,type)`/`(repId,type)` upsert keys preserved.
- Thin envelope with `data.aiStructured` (media.transcribed) and `data.daySummary` (day.ended).
- Signing: HMAC-SHA256 over `${timestamp}.${payload}`; `sha256=<hex>`; ±5 min replay window.
- No LLM calls in the backend; all reasoning lives in the external Hermes agent.

## Things to confirm at activation (couldn't verify — shell + GitHub egress both down at staging)
1. **`logEvent` field names** for the step-3 hook — adjust the mapping to the live `events.ts`.
2. **zod import** — overlay uses `import { z } from "zod/v4"` to match the R1 db schema files.
   If api-server resolves zod differently, adjust the import in `webhook-envelope.ts`.
3. **Node ≥ 18** for global `fetch` (Express 5 implies Node ≥ 20, so this is safe).

## Why staged (not activated here)
Activation steps 2, 4, 5 run commands (`pnpm`, `node`, `git`) that need a working shell. During
this session the sandbox shell failed to provision (`useradd: input/output error` — an infra fault,
unrelated to the project) and GitHub egress timed out, so the code was written and validated by
inspection but not executed. None of that blocks activation: this bundle is complete source; run
the steps above wherever a shell is available. Replit is ideal because the Neon `DATABASE_URL` and
the Replit secrets (`AGENT_API_KEY`, `HERMES_WEBHOOK_URL`, `HERMES_WEBHOOK_SECRET`) already live there.
