# Next-session kickoff prompt

Paste this into a fresh session to continue.

---

Continue the Sales-Visit-Log / Hermes work. Context:

- Repo: https://github.com/jdb-swissknife/Sales-Visit-Log (branch `main`). Clone
  fresh. Bootstrap gotchas (sandbox):
  - No root. pnpm via `corepack` (don't `corepack enable` — needs root; call
    `corepack pnpm ...`). The global pnpm store can be read-only / collide with a
    prior session's leftovers, so install with a FRESH unique store + cache:
    `corepack pnpm install --frozen-lockfile --store-dir $(mktemp -d /tmp/pnpmstore.XXXXXX) --config.cacheDir=$(mktemp -d /tmp/pnpmcache.XXXXXX)`.
    Likewise, a leftover read-only clone dir (`/tmp/svl`) can't be `rm`'d — clone
    into a unique dir (e.g. `svl_$(date +%s)`).
  - The install prints `[ERR_PNPM_IGNORED_BUILDS] esbuild` — that's expected.
    Run package binaries from `node_modules/.bin` directly, NOT via `pnpm run`
    (its pre-run dep-check trips on the unapproved esbuild build script):
    - tsx: `node_modules/.pnpm/node_modules/.bin/tsx`
    - tsc: root `node_modules/.bin/tsc`
    - drizzle-kit: `lib/db/node_modules/.bin/drizzle-kit`
  - The install also writes an `allowBuilds:` stub into `pnpm-workspace.yaml` —
    DON'T commit that; `git checkout -- pnpm-workspace.yaml` before diffing.
  - User-space Postgres (only needed for the api-server suite — it skips without
    `DATABASE_URL`): `pip install pgserver --break-system-packages`; bins under
    `.../site-packages/pgserver/pginstall/bin`. **Background processes don't
    survive between shell calls** — init + start `pg_ctl` + `drizzle-kit push
    --force` + run tests must all be in ONE shell call. Use `--auth=trust`, a
    non-default port, a UNIQUE datadir (`mktemp -d`), and a unix socket in
    `/tmp` (`-k /tmp -c listen_addresses=''`); URL form
    `postgresql://postgres@/svl?host=/tmp&port=<port>`.
- Hermes is a scheduled, advisory-only LLM agent harness. Instructions live in
  the project folder: `HERMES-SYSTEM-PROMPT.md` and `HERMES-OPERATING-GUIDE.md`.
- The `phase3-staging/` folder is stale history — ignore it.

## What's shipped to `main` (done — do not redo)

- `nearby_prospect` behavior, end-to-end (`artifacts/hermes-agent`): proximity
  core, Bearer HTTP client, orchestrator (anchor = rep's most recent visit), CLI.
- Server-side rep-scope of the events feed: nullable `rep_id` on `events`
  (+ composite index) and `visits`; `logEvent` persists `repId`;
  `GET /api/agent/events?repId=` filters (absent = unfiltered; NULL rep never
  matches).
- Multi-rep `nearby_prospect` harness: `runHarness` runs the behavior once per
  active rep (rep list from `HERMES_REP_IDS` config); `POST /api/agent/runs`
  route + `HermesClient.createRun`; per-rep run tracking + failure isolation;
  `run-harness` CLI.

## Just finished (this session): `debrief` on `day.ended`

Implemented as `hermes-debrief.patch` (apply instructions:
`HERMES-DEBRIEF-APPLY.md`). Hermes-agent-only, **no schema/server change** (the
server already accepts `type: debrief`; the feed already serves `day.ended` with
its `daySummary` in `payload`, rep-scoped). **NOT yet pushed** (sandbox has no
push credentials) — **apply the patch in Replit and push first.**

What it does — one rep-level card per rep at day's end: short recap + 2–3
focused priorities for tomorrow, grounded in the rep's most-recent `day.ended`
`daySummary`. `type: debrief`, dedupe `hermes:debrief:{repId}:{date}`,
`expiresAt` = end of next day, priority `normal`, no `businessId`.

- `src/debrief.ts`: tolerant `parseDaySummary` (free-form, synonym-aware, never
  throws) + pure `buildDebrief` (grounded recap, explicit-or-derived priorities,
  `null` → skip when empty) + `runDebrief` I/O shell with run lifecycle
  (`running → completed|skipped|failed`; skip reasons `no_day_ended`,
  `stale_day_ended`, `empty_day_summary`).
- `src/run-debrief.ts`: multi-rep CLI (`HERMES_REP_IDS`), per-rep run tracking +
  isolation, mirroring `run-harness`; tracked-run eventType `debrief.scheduled`.
- `src/types.ts`: `SuggestionType` union; `SuggestionPayload` generalized so
  rep-level cards may omit `businessId`/`actionUrl`/`priorityScore` (`data` stays
  required; `nearby_prospect` unchanged).
- **Decisions:** scheduled (not event-driven), consistent with the harness;
  staleness guard (`maxStaleHours`=36) + per-day dedupe make late/frequent runs
  safe. `runHarness` left nearby-specific — `run-debrief` owns its own loop
  (smaller diff) rather than generalizing the harness now.
- Verified: typecheck clean; hermes-agent 43/43 (26 prior + 17 new); api-server
  13/13; patch applies cleanly on a fresh `main`.

## Today's task: pick the next behavior

Confirm `hermes-debrief.patch` is applied + pushed and the suites still pass
(api-server 13, hermes-agent 43), then choose one:

1. **`coaching` behavior** (`HERMES-OPERATING-GUIDE.md` §8.C) — the remaining
   per-behavior playbook. One specific, constructive, actionable tip per rep
   from patterns across `visit.created`/`visit.updated`/`media.transcribed`
   (not a single visit). `type: coaching`, dedupe
   `hermes:coaching:{repId}:{period}`, priority `normal`; persist the underlying
   pattern as a `rep-insight` (`conversion_trend`/`coverage`/`streak`) via
   `POST /api/agent/rep-insights` so it compounds. No expiry (or end of period).
   Reuse the client + run-lifecycle patterns.
2. **Generalize the harness** — fold `nearby_prospect` + `debrief` (and soon
   `coaching`) into one behavior-agnostic per-rep runner, replacing the
   duplicated loops in `run-harness`/`run-debrief`. Touches shipped code + tests;
   do only if the third behavior makes the duplication clearly worth it.

## Open follow-ups (not blocking)

- `GET /api/agent/reps` to replace the `HERMES_REP_IDS` config once a rep
  registry exists (shared by all multi-rep CLIs).
- Real rep identity at the auth layer (app must send `repId` on visit creation)
  = the deferred "team auth" work.
