# Applying the harness-schedule patch

`hermes-harness-schedule.patch` — wires the `nearby_prospect` behavior into a
multi-rep scheduling harness, and adds the `POST /api/agent/runs` server surface
the harness needs to open tracked runs. Built on `main` at commit `85d37dc`
(the rep-scoped events feed). Verified end-to-end in a sandbox: full typecheck
clean, **api-server 13/13** (4 new + 9 existing), **hermes-agent 26/26**
(5 new + 21 existing).

Code-only — **no schema change, no drizzle push required.**

## What the patch does

- **`POST /api/agent/runs` (new route, `artifacts/api-server/src/routes/agent.ts`):**
  opens a run for a scheduled/harness-driven behavior (event-triggered runs are
  still created by the webhook ingest). Body: `eventType` (required),
  `eventId` (optional — auto-generated as `agent-run:{eventType}:{ISO}` if
  absent), optional `externalRunId` / `correlationId` / `status`
  (`queued` default, or `running` to stamp `startedAt`). Returns `201` with the
  new `agent_runs` row (incl. `id`). Mirrors the existing `PATCH /agent/runs/:id`.
- **`HermesClient.createRun` (`artifacts/hermes-agent/src/client.ts`):** thin
  `POST /api/agent/runs` wrapper returning `{ id }`.
- **`runHarness` (`artifacts/hermes-agent/src/harness.ts`, new):** runs the
  `nearby_prospect` behavior once for every active rep. For each rep it opens a
  tracked run via `createRun`, then calls
  `runNearbyProspect({ client, repId, now, agentRunId })` — which already walks
  the run lifecycle (`running → completed/skipped/failed`) via
  `PATCH /agent/runs/:id`. **Per-rep failures are isolated**: one rep throwing
  never aborts the others; the harness records the error on that rep's outcome
  and never throws for a field error. Also exports `parseRepIds` (splits a
  comma/whitespace-separated env list).
- **`run-harness` CLI (`artifacts/hermes-agent/src/run-harness.ts`, new):**
  one-shot entry intended to be invoked on a cadence by an external scheduler.
  Reads `HERMES_REP_IDS` (comma-separated) + `AGENT_API_KEY` + `HERMES_BASE_URL`.
  Added as the `run-harness` package script.
- **`index.ts`** re-exports the harness.

## Two design decisions baked in

1. **Per-rep location needs no new input.** `runNearbyProspect` derives each
   rep's anchor from that rep's most-recent visit via
   `GET /agent/events?repId=`. Because the feed is now rep-scoped server-side,
   two reps run in the same tick get **independent anchors** — proven by the
   `runHarness` test (`rep-A` anchors to its own visit, `rep-B` to its own, and
   neither matches the other's neighbor). The harness only needs the rep *list*.
2. **Rep list source is config for now** (`HERMES_REP_IDS`). There is no rep
   registry / auth yet (the deferred "team auth" work), so there is nothing to
   enumerate server-side. The intended long-term source is a
   `GET /api/agent/reps` context endpoint, to be added once team auth lands.

## Apply in Replit

This patch is a plain `git diff` (not a `git am` mailbox), so apply with
`git apply`:

```bash
git status                       # must be clean; stash/commit anything pending
git checkout main
git pull                         # base must match origin/main (85d37dc)
git apply --check hermes-harness-schedule.patch   # dry run; should print nothing
git apply hermes-harness-schedule.patch
corepack pnpm install --frozen-lockfile           # no-op if deps unchanged
git add -A && git commit -m "feat(hermes): multi-rep nearby_prospect harness + POST /api/agent/runs"
```

Then typecheck and run tests (prior-session gotchas still apply — don't
`corepack enable`; run binaries from `node_modules/.bin` directly):

```bash
# typecheck
./node_modules/.bin/tsc --build
( cd artifacts/api-server  && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit )
( cd artifacts/hermes-agent && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit )

# tests
( cd artifacts/api-server  && ./node_modules/.bin/tsx --test tests/*.test.ts )   # 13 pass (needs DATABASE_URL)
( cd artifacts/hermes-agent && ./node_modules/.bin/tsx --test tests/*.test.ts )  # 26 pass

git push
```

If `git apply --check` fails it's almost always a dirty tree or wrong base —
re-check you're on a clean `main` at `85d37dc`.

## Running the harness

```bash
HERMES_BASE_URL=http://localhost:8080 \
AGENT_API_KEY=... \
HERMES_REP_IDS=rep-7,rep-9 \
corepack pnpm --filter @workspace/hermes-agent run-harness
```

The behavior's own drop-in time gate (09:00–17:00 local) and per-day `dedupeKey`
make frequent invocation safe — re-runs refresh cards rather than stack, and
runs outside the window close as `skipped`. Point your external cron at this
command.

## Open follow-ups

- **`GET /api/agent/reps`** — replace the `HERMES_REP_IDS` config with a real
  active-rep list once team auth / a rep registry exists. (Noted server surface.)
- **Real rep identity** at the auth layer — the app must send `repId` on visit
  creation for the anchor to be correct per rep. Still the deferred "team auth"
  work.
- **`debrief` on `day.ended`** — the next behavior; reuse the proximity/client
  and run-lifecycle patterns.
