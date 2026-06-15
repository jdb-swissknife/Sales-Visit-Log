# Phase 3 Rebuild Plan — Hermes app-side (supersedes CHUNK1_PLAN.md)

_Created 2026-06-13. Reason: Fable 5's Phase 3 build was never committed to Replit or pushed to
GitHub, and was confirmed lost (see "What happened" below). This plan rebuilds the Phase 3 app side
from scratch against the live Phase 2 baseline, with the Chunk-1 contract reconciliations folded in._

---

## What happened (so the next session has the full story)
- GitHub `main` is at commit **`2e15a06` "Merge Replit map fixes with Phase 2"** — this is **Phase 2**.
- The only branch is `main`. Commit `f1c61ac` (the Phase 3 commit referenced in `HERMES_STATUS.md`)
  is **not in GitHub** and **not in Replit** (Replit working tree is clean at `2e15a06`).
- Fable 5 built Phase 3 in its own session; that work was **never written to Replit and never
  committed**, so it is gone. A workspace-wide `find` on Replit turned up no Hermes files (the one
  `agent.ts` hit was an unrelated Mastra skill template under `.local/skills/`).
- Therefore `HERMES_STATUS.md`'s "built & wired" inventory describes code that **no longer exists**.
  Keep that doc only as a **spec / intent** reference, not a description of current reality.

## Corrected facts vs. the old docs
- **Baseline = GitHub `main` (Phase 2, `2e15a06`)**, NOT the local OneDrive folder. The OneDrive folder
  is *older* than `main` (its `api-server/src/routes/` has only health/stats/storage; `main` also has
  businesses/events/media/notes/visits/index/routes).
- **Real repo paths have no `app/` prefix.** Correct roots:
  - API server: `artifacts/api-server/`
  - DB package: `lib/db/` (workspace pkg `@workspace/db`, Drizzle ORM) — schema in `lib/db/src/schema/`
  - Zod contracts: `lib/api-zod/`
  - Frontend: `artifacts/sales-outreach/`
- **Stack (confirmed from `artifacts/api-server/package.json`):** Express 5, `drizzle-orm`,
  `@workspace/db` (workspace:*), `@workspace/api-zod`, zod (catalog), GCS object storage, pino, multer.
  pnpm workspaces with `catalog:` versions. Build via `build.mjs` (esbuild). `typecheck` = `tsc --noEmit`.

## Locked decisions (carried over from HERMES_STATUS.md — still valid)
1. **IDs:** app DB is authoritative; **integer serial PKs** everywhere. Hermes adapts. ULIDs live only
   in suggestion `externalId` and envelope `eventId`.
2. **Runtime:** **Hybrid** — deterministic, no-LLM suggestions in-app; all LLM/memory reasoning in the
   external Hermes agent. No model calls in the backend.
3. **Priority enum:** keep storage on `low|normal|high|urgent`; accept contract `medium` as an alias
   normalized to `normal` on input. (Step 1 of old plan.)
4. **Insight schema:** expand now (additive) so the Chunk-4 agent writes without a 2nd migration.
5. **Outbound envelope:** thin overall, but include `media.aiStructured` on `media.transcribed` and the
   `daySummary` counts on `day.ended`.
6. **WEBHOOK_VERSION:** single agreed constant, inbound stays permissive (accepts any version string).
   **LOCKED 2026-06-13: `WEBHOOK_VERSION = "2026-06-12"`** (matches the contract example). Outbound
   envelopes stamp this value; inbound accepts any version string.

---

## Prerequisite — establish the Phase 2 baseline in the working folder
Before any code: get GitHub `main` (Phase 2) into the working folder so edits are against the live tree.
Either:
- (Recommended) `git clone` GitHub `main` into the folder (or `git pull` if the folder is wired to the
  repo), replacing the stale local `app/`-prefixed snapshot; OR
- Re-export the current Replit project (which is at `2e15a06`) into the folder.
Confirm the baseline by checking that `artifacts/api-server/src/routes/` contains `businesses.ts`,
`events.ts`, `visits.ts`, `media.ts`, `notes.ts` and that `lib/db/src/schema/index.ts` exists.

---

## Step 0 — Verify first (read these Phase 2 files before writing anything)
These set the conventions the new code must match. Read at the start of the build session:
1. `lib/db/src/schema/index.ts` — how tables are declared/exported (Drizzle style, naming, id pattern).
2. One existing schema file (e.g. `lib/db/src/schema/businesses.ts` if present, else `visits.ts`) —
   column helpers, timestamps, FK pattern, integer serial PK confirmation.
3. `lib/db/` package root — `drizzle.config.*` / migration command (`push` vs generated SQL), and the
   `@workspace/db` export surface (does it export `db`, the client, and the schema?).
4. `artifacts/api-server/src/routes/index.ts` — how routers are registered/mounted.
5. `artifacts/api-server/src/lib/events.ts` — the `logEvent` path (where outbound webhooks hook in).
6. `artifacts/api-server/src/app.ts` (or server entry) — middleware order, where `express.json()` is,
   so the inbound webhook receiver can mount BEFORE it (raw body needed for HMAC).
7. `lib/api-zod/` — existing zod contract style (so new request/response schemas match).
8. Confirm whether any test harness exists (vitest config / `tests/`); Phase 2 may have none — if so,
   adding vitest is part of R5.

---

## Build sub-chunks (one per session; keep context lean)

### R1 — DB schema + migration (the foundation)   [STAGED — see repo-overlay/lib/db/src/schema/]
Add to `lib/db/src/schema/` (additive; export all from `index.ts`):
- `agent-suggestions.ts` — integer PK; `externalId` (text, unique, nullable for in-app);
  `businessId` (int FK), `agentRunId` (int FK nullable), `type`, `title`, `body`/`summary`,
  `priority` (`low|normal|high|urgent`, default `normal`), `status` (unread default),
  `dedupeKey` (text, unique), lifecycle timestamps (`readAt`/`actedAt`/`dismissedAt`), `createdAt`.
- `agent-runs.ts` — integer PK; `eventId`, `eventType`, `externalRunId`, `runType`
  (`webhook|cron|manual`), `repId`, `businessId`, `status` (`queued|running|completed|skipped|failed`),
  `reason`, `inputSummary`, `outputSummary`, `contextSnapshot` (jsonb), `correlationId`,
  `errorMessage`, `startedAt`, `finishedAt`.
- `agent-event-receipts.ts` — `eventId` (unique idempotency key), `eventType`, `source`,
  `correlationId`, `repId`, `businessId`, `payload` (jsonb), `processingStatus`
  (`received|processed|ignored|failed`, default `received`), `processedAt`, `errorMessage`.
- `insights.ts` — prospect + rep insights, expanded per decision 4: `insightType`, `title`,
  `body`/`summary`, `confidence` (reuse `score`), `status` (`active|superseded|dismissed`, default
  `active`), `dedupeKey` (unique), `sourceRunId`/`sourceEventId`/`sourceVisitId`/`sourceMediaId`,
  `firstObservedAt`/`lastConfirmedAt`/`expiresAt`, `metadata` (jsonb), plus the existing
  `(businessId,type)` / `(repId,type)` upsert key kept.
- **Migration:** additive only. Apply via the repo's existing mechanism (`db push` to Neon). No renames,
  no drops — keep `summary`/`score` as body/confidence to avoid touching Phase 2 data.
- **Done:** `pnpm --filter @workspace/db run <push>` applies cleanly; `typecheck` green.

### R2 — Server lib (envelope, signing, events hook, auth, SSE bus)   [STAGED — see repo-overlay/artifacts/api-server/src/]
- `artifacts/api-server/src/lib/webhook-envelope.ts` — canonical envelope zod schema. Entity IDs
  `z.number().int()`; `eventId` ULID/text. Include optional `media.aiStructured` and `daySummary`.
  `WEBHOOK_VERSION` constant (decision 6). Clear 400 messages on bad ID types.
- `artifacts/api-server/src/lib/webhooks.ts` — `buildEnvelope` + HMAC-SHA256 signing + fire-and-forget
  send with 1 retry. Reads `HERMES_WEBHOOK_URL` / `HERMES_WEBHOOK_SECRET`.
- Hook outbound firing into existing `lib/events.ts` `logEvent` (central emit point).
- `artifacts/api-server/src/middlewares/agent-auth.ts` — `requireAgentKey`: 503 if `AGENT_API_KEY`
  unset, Bearer check otherwise.
- `artifacts/api-server/src/lib/suggestion-bus.ts` — in-memory pub/sub for SSE.
- **Done:** typecheck green; unit-level sanity on envelope parse + signature.

### R3 — Routes (agent API, suggestions feed, inbound receiver, insights read)   [STAGED — see repo-overlay/artifacts/api-server/src/routes/]
- `routes/agent.ts` — `GET /api/agent/events`, `GET /api/agent/context`,
  `POST /api/agent/suggestions` (dedupeKey upsert; priority normalize `medium→normal`),
  `PATCH /api/agent/runs/:id`, `POST /api/agent/prospect-insights`, `POST /api/agent/rep-insights`
  (accept expanded insight fields). All behind `requireAgentKey`.
- `routes/suggestions.ts` — `GET /api/suggestions`, `PATCH /api/suggestions/:id` (read/acted/dismissed,
  timestamped), `GET /api/suggestions/stream` (SSE via suggestion-bus).
- `routes/webhooks-inbound.ts` — mount BEFORE `express.json()`; HMAC verify, ±5min replay window,
  `eventId` dedupe via `agent_event_receipts`, queue an `agent_runs` row (`status:"queued"`),
  set `source`/`correlationId`/`processingStatus`.
- `routes/insights.ts` (new) — `GET /api/insights/prospect?businessId=`,
  `GET /api/insights/rep?repId=` (app-facing, no agent key).
- Register all in `routes/index.ts`.
- **Done:** typecheck green; routes mount; manual curl smoke (once secrets set) returns expected shapes.

### R4 — Frontend (suggestions feed + insight display)   [NOT YET STAGED]
- `artifacts/sales-outreach/` — `components/suggestions-feed.tsx`, `hooks/use-suggestions.ts`
  (fetch + SSE + status mutation, handles dedupe upserts), integrate into layout.
- Minimal prospect-insight display on the business detail view (rep insights can wait).
- **Done:** builds; feed renders; SSE updates live.

### R5 — Tests + activation   [NOT YET STAGED]
- Add vitest (if absent) + tests: priority alias, dedupeKey upsert, inbound valid-signature→200 creates
  run, string ID→400, duplicate eventId→200 `{duplicate:true}`, suggestions list/PATCH lifecycle,
  insights read returns rows.
- Activation: `db push`; set Replit secrets `AGENT_API_KEY`, `HERMES_WEBHOOK_URL`,
  `HERMES_WEBHOOK_SECRET`; smoke test one suggestion (appears via SSE) + one signed inbound round-trip.
- Commit + push each sub-chunk so Phase 3 is finally in version control.

---

## Done when
- Phase 3 app side is rebuilt on top of Phase 2, **committed and pushed** (it never was before).
- App compiles; additive migration applies with no Phase 2 data loss.
- Hermes can POST suggestions (integer IDs, `medium` accepted) and they appear live via SSE.
- Signed inbound webhooks with integer IDs are accepted, deduped, and create `agent_runs` rows.
- Insights are readable via API (+ minimal UI).
- Existing Phase 2 behavior unchanged; no LLM calls in the backend.

## Status (2026-06-13)
- **R1 — staged** (repo-overlay/lib/db/src/schema/). Not yet typechecked/migrated/committed.
- **R2 — staged** (repo-overlay/artifacts/api-server/src/). Not yet typechecked/committed; `logEvent` hook left for activation.
- **R3 — staged** (repo-overlay/artifacts/api-server/src/routes/). Writes + suggestions + inbound + insights are R1/R2-backed and complete; `GET /agent/events` + `GET /agent/context` have `PHASE2-DEP` blocks to reconcile against the live events/businesses/visits/notes tables. Registration is manual — see routes/PHASE3-REGISTER.md. Not yet typechecked/committed.
- **R4 (frontend), R5 (tests + activation) — not yet built.**
- Reason staging stalled at execution: build shell `useradd: input/output error` (infra fault) + GitHub egress timeouts. Code complete; activation needs a shell (Replit recommended). See ACTIVATION.md.
