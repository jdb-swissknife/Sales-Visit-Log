# CLAUDE.md — Sales-Visit-Log

Project instructions for working on the Sales-Visit-Log (a.k.a. OutreachLog /
sales-outreach) field-sales outreach tool.

## Repository

- GitHub: https://github.com/jdb-swissknife/Sales-Visit-Log
- Always start new work from updated `main`. Never branch from `feat/callback-cron`
  (merged and dead). One feature branch per change; PR into `main`.

## Stack

- Monorepo: **pnpm workspaces** (root `package.json` name is `workspace`)
- Node.js **24**; package manager **pnpm** (root `preinstall` rejects npm/yarn)
- TypeScript **5.9**
- API: **Express 5**
- DB: **PostgreSQL + Drizzle ORM**
- Validation: **Zod** (`zod/v4`), `drizzle-zod`
- API codegen: **Orval** (from OpenAPI spec)
- Build: **esbuild** (CJS bundle)
- Frontend artifact: React + Vite + shadcn/ui (Tailwind), MapLibre GL for maps

## Layout

```
artifacts/
  api-server/      Express API; callback-reminder cron lives here
  sales-outreach/  React frontend (map page, quick-log drawer, etc.)
  mockup-sandbox/  UI mockup playground
lib/
  db/              Drizzle schema, seed data, push/migrate
  api-spec/        OpenAPI spec + codegen
  api-zod/         generated Zod schemas
  api-client-react/ generated React query hooks
scripts/           one-off scripts (e.g. geocode)
```

## Key commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/api-server test` — **DB-backed** tests (needs Postgres)
- `pnpm --filter @workspace/db run push` — push schema to dev/test DB
- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks + Zod from spec

## Verification (run before every PR/merge)

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server build
```

All three must pass. The test suite needs a live Postgres (`DATABASE_URL`).

## Conventions / guardrails

- **Database skill rules:** no startup-time DDL and no custom prod migration
  scripts; prod queries are read-only. Pure DML data backfills on startup are OK.
- Production DB is a **separate instance** from dev; schema auto-applies at publish,
  but data does not copy. See `PROJECT-CONTEXT.md` before touching prod data.
- Geocoding only fires inside business POST/PUT handlers — seeded rows have null
  coords until the startup backfill runs. See `PROJECT-CONTEXT.md`.
- Map page must never render a blank canvas; always fall back to a usable list.
  See `PROJECT-CONTEXT.md` (MapLibre robustness) before editing the map.
- Regenerate codegen after changing the OpenAPI spec; don't hand-edit generated
  `api-zod` / `api-client-react` files.

## Context cost note (user preference)

When the chat context grows long and costly, advise the user to break the work
into chunks, save progress, and start a fresh task.
