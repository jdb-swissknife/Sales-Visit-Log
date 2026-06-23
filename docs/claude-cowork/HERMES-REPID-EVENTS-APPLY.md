# Applying the rep-scope events patch

`hermes-repid-events.patch` — server-side `repId` filter for
`GET /api/agent/events` (closes the gap where the client sent `?repId=` but the
server ignored it). Built on top of `main` at commit `b534e1e`
(the `nearby_prospect` system). Verified end-to-end in a sandbox: full
typecheck clean, api-server 9/9 tests pass (5 new + 4 existing callback-cron),
hermes-agent 21/21 still pass.

## Step 0 outcome — it was Case B

Neither `events` nor the linked `visits` table carried any rep/user identity.
The only rep concept in the schema was the free-form `rep_id` text on
`agent_suggestions` / `insights` ("until team auth lands"). So a schema change
was required, and historical backfill is a **documented no-op** (no rep was
derivable from any existing row).

## What the patch does

- **Schema (drizzle push, no SQL migration files in this repo):**
  - `events`: new nullable `rep_id` + index `events_rep_type_created_idx`
    on `(rep_id, type, created_at)` to keep the per-rep anchor lookup cheap.
  - `visits`: new nullable `rep_id` (free-form, mirrors `agent_suggestions`),
    so a visit's rep flows into its `visit.created` event.
- **Write path:** `logEvent` accepts + persists `repId` (and forwards it in the
  webhook envelope); the visits routes populate the event rep from the
  originating visit on create/update/delete. This is the literal reading of the
  spec's "set the rep from the originating visit."
- **Read path:** the events route adds `WHERE rep_id = ?` when `repId` is
  supplied. Omitting it is unfiltered (back-compat). A NULL `rep_id` never
  matches an explicit `repId`, so two reps' feeds stay isolated.
- **api-zod:** `ListEventsQueryParams` gains `repId`; `CreateVisitBody` gains an
  optional `repId`. `ListEventsResponseItem`'s nullable columns
  (`payload` **and** `entityType/entityId/businessId/visitId/repId`) are now
  `.nullable().optional()` — a NULL row no longer 500s the feed. (The spec
  flagged `payload`; testing surfaced that the same bug hits any event with a
  null column, e.g. `suggestion.created` has a null `visitId` in production, so
  the fix was extended to all of them.)
- **openapi.yaml** updated as the generation source of truth (hand-applied to
  the generated files to avoid orval-version reformatting churn; a fresh
  `pnpm --filter @workspace/api-spec codegen` reproduces the same shape).

## Apply in Replit

```bash
git status        # must be clean; stash/commit anything pending
git checkout main
git pull          # base must match origin/main (b534e1e)
git am hermes-repid-events.patch
corepack pnpm install --frozen-lockfile   # no-op if deps unchanged
```

Then push the new schema and run tests (gotchas from prior sessions still apply
— don't `corepack enable`; run binaries from `node_modules/.bin` directly):

```bash
# push schema (events.rep_id, visits.rep_id, the new index)
( cd lib/db && ./node_modules/.bin/drizzle-kit push )

# typecheck
./node_modules/.bin/tsc --build
( cd artifacts/api-server && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit )

# tests
( cd artifacts/api-server && ./node_modules/.bin/tsx --test tests/*.test.ts )       # 9 pass (needs DATABASE_URL)
( cd artifacts/hermes-agent && ./node_modules/.bin/tsx --test tests/*.test.ts )      # 21 pass

git push
```

If `git am` fails it's almost always a dirty tree or wrong base — `git am --abort`,
re-check you're on a clean `main` at `b534e1e`, retry.

## Note on the visits `rep_id`

The patch stores rep on both the event and the visit. The events feed only needs
the event-level rep for the `nearby_prospect` anchor, but carrying it on the
visit too keeps the model coherent and makes "backfill from the linked visit's
rep" meaningful for future rows. There is still **no auth/session** supplying the
rep — callers (the app) must send `repId` on visit creation. Wiring a real rep
identity at the app/auth layer remains the deferred "team auth" work.
