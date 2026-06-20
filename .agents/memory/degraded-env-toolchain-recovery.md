---
name: Working through a partial Nix-mount / toolchain outage
description: How to keep making safe progress when git/pnpm/node binaries fail with "Transport endpoint is not connected" but the filesystem and DB still work.
---

# Degraded environment: Nix store FUSE mount disconnected

**Symptom:** Spawning binaries (`git`, `pnpm`, `node`, `patch`) fails with `Transport endpoint is not connected`; the `bash` tool may also return intermittent 500s. The Nix store FUSE mount has dropped.

**What still works during such an outage:**
- Node's own `fs` (read/write workspace files) via the already-running `code_execution` sandbox.
- `/bin/sh` builtins (`echo`) and coreutils on healthy mounts (`ls`).
- The `executeSql` callback (talks to Postgres directly, no Nix binary needed).
- Recovery is **staged** — binaries come back on different mounts at different times (observed: `git` recovered well before `node`/`pnpm`).

**Why:** the breakage is infrastructure (mount), not the code/patch. A browser tab reload does NOT remount it — only a genuine container restart does.

**How to apply / playbook:**
- Probe with `execSync` in the sandbox, not the flaky bash tool. Stop re-probing the same binary once the result is consistent; re-probe only when there's positive evidence of staged recovery (e.g. another binary just came back).
- Once `git` is back, apply git-format patches with `git apply` (run `git apply --check` first). A patch that includes its generated/codegen output in the hunks means you do NOT need to re-run codegen.
- If `pnpm db push` is unavailable, apply schema changes with idempotent direct SQL (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) via `executeSql`, matching drizzle's exact column/index names from the schema files. A later `drizzle push` then reports "No changes detected" (verified clean no-op).
- Do NOT `restart_workflow` while node/pnpm are down: the workflow's `pnpm … dev` can't respawn, so a currently-running server would go down with no way back up. Defer restart + typecheck + tests until the toolchain returns.
