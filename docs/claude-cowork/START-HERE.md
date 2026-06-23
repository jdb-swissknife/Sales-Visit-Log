# START HERE — Sales-Visit-Log dev bootstrap

This is the first file to read in this project. It gets a fresh, shell-enabled
environment from nothing to a verified working copy of the codebase.

The code is **not** stored in this folder. The single source of truth is GitHub.
You will clone it.

- Repo: https://github.com/jdb-swissknife/Sales-Visit-Log
- Branch to start from: `main` (merge commit `f4aff919921818d5274463701751ec067d03b832`)
- Do **not** branch from `feat/callback-cron` — it was merged and is dead.

---

## 1. Prerequisites (install before anything else)

The repo's root `preinstall` hard-fails on npm/yarn, so pnpm is mandatory.

- **Node.js 24** — check with `node --version`
- **pnpm** — check with `pnpm --version`; install with `corepack enable && corepack prepare pnpm@latest --activate`
- **PostgreSQL** — required because the api-server test suite is DB-backed.
  Check with `psql --version`. You need a reachable instance and a test database.

If the shell lacks any of these, install them first. On a Debian/Ubuntu sandbox:

```bash
# Node 24 (via nodesource or nvm), then:
corepack enable
# Postgres:
sudo apt-get update && sudo apt-get install -y postgresql
sudo service postgresql start
```

---

## 2. Clone and install

```bash
git clone https://github.com/jdb-swissknife/Sales-Visit-Log.git
cd Sales-Visit-Log
git checkout main
git pull origin main
pnpm install
```

After cloning, the repo root contains `package.json` (name `workspace`),
`artifacts/`, `lib/`, and `scripts/`. There is no `app/` wrapper inside the repo.

---

## 3. Provide environment variables

The api-server and its tests need a Postgres connection plus the cron flags.
Create a test database and set:

```bash
export DATABASE_URL="postgres://USER:PASS@localhost:5432/sales_visit_log_test"

# Callback-reminder cron flags (all optional; defaults shown)
export CALLBACK_CRON_ENABLED=true     # set false to disable the sweep
export CALLBACK_CRON_HOUR=7           # 0-23, clamped
export CALLBACK_CRON_TZ_OFFSET_MIN=0  # local-day offset in minutes
```

Push the schema to the test DB before running tests:

```bash
pnpm --filter @workspace/db run push
```

---

## 4. Verify (run all three; all must pass)

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server build
```

Expected at last known-good state: typecheck clean, **4 api-server tests pass /
0 fail / 0 skip**, build succeeds. If any fail, fix the environment (usually
Postgres connectivity or Node version) before writing new code.

---

## 5. Daily workflow

```bash
git checkout main && git pull origin main   # always start from updated main
git checkout -b feat/your-feature           # new branch per change
# ...work...
pnpm run typecheck && pnpm --filter @workspace/api-server test
```

Open a PR into `main`. Re-run the three verification commands before merging.

---

## Other handoff files in this package

- `CLAUDE.md` — project instructions; copy to the repo/project root so the
  assistant knows the stack, layout, and conventions.
- `PROJECT-CONTEXT.md` — carried-over context: the callback-cron feature state
  and three hard-won engineering notes (prod DB self-heal, MapLibre robustness).
  Read it before touching the map page, geocoding, or production data.
