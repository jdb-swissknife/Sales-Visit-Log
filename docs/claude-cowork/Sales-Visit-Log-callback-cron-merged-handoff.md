# Sales-Visit-Log Callback Cron Merge Handoff

Update: callback-reminder cron work is complete and merged.

## Repo

https://github.com/jdb-swissknife/Sales-Visit-Log

## Merged PR

https://github.com/jdb-swissknife/Sales-Visit-Log/pull/1

## Merge commit

`f4aff919921818d5274463701751ec067d03b832`

## Feature branch

`feat/callback-cron`

## What landed

- Added deterministic in-app callback-reminder cron:
  - `artifacts/api-server/src/lib/callback-cron.ts`

- Wired the cron into api-server startup:
  - `artifacts/api-server/src/index.ts`

- Added DB-backed node:test coverage:
  - `artifacts/api-server/tests/callback-cron.test.ts`

- Added api-server test script and `tsx` dev dependency:
  - `artifacts/api-server/package.json`
  - `pnpm-lock.yaml`

## Behavior now implemented

- The api-server runs an in-app deterministic callback sweep.
- It emits `callback_reminder` suggestions for due and overdue callbacks.
- Overdue callbacks get `priority = "high"`.
- Due-today callbacks get `priority = "normal"`.
- Future callbacks are skipped.
- Superseded callbacks are skipped when a later visit exists for the same business.
- Suggestions use deterministic dedupe keys:
  - `cb-due:{visitId}:{YYYY-MM-DD}`
- Re-running the sweep refreshes existing cards instead of creating duplicates.
- Suggestions get `expiresAt` set to the end of the configured local day.
- Suggestions use `source = "system"`.
- The sweep records lifecycle in `agent_runs`:
  - `queued -> running -> completed/skipped/failed`

## Env flags

- `CALLBACK_CRON_ENABLED`
  - default enabled
  - set to `false` to disable

- `CALLBACK_CRON_HOUR`
  - default `7`
  - clamped 0-23

- `CALLBACK_CRON_TZ_OFFSET_MIN`
  - default `0`

## Verification completed before merge

- `pnpm run typecheck` passed
- `pnpm --filter @workspace/api-server typecheck` passed
- `pnpm --filter @workspace/api-server build` passed
- DB-backed tests passed against a fresh local Postgres test DB:
  - 4 tests passed
  - 0 failed
  - 0 skipped

## DB-backed test command

```bash
pnpm --filter @workspace/api-server test
```

## The test suite covers

- overdue callback emits high-priority reminder
- due-today callback emits normal-priority reminder
- superseded callback emits no reminder
- future callback emits no reminder
- run lifecycle closes cleanly
- second sweep refreshes existing suggestion, no duplicates
- no-op sweep completes/skips cleanly

## Before continuing development

Make sure your working copy is on updated `main`:

```bash
git checkout main
git pull origin main
```

Install/update deps:

```bash
pnpm install
```

Re-run verification:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server build
```

## Important

Do not continue from the old `feat/callback-cron` branch. That branch was merged. Start new work from updated `main`.
