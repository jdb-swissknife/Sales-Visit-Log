/**
 * One-shot CLI: pull Plaud recordings for all reps and sync into SVL.
 *
 * Per-rep Plaud accounts are configured via environment variable:
 *   PLAUD_REPS=rep-7:/home/app/.plaud-tokens/rep-7,rep-9:/home/app/.plaud-tokens/rep-9
 * (comma-separated repId:tokenDir pairs)
 *
 *   HERMES_BASE_URL=http://localhost:8080 AGENT_API_KEY=*** \
 *   OPENAI_API_KEY=*** PLAUD_REPS=rep-7:/path/to/tokens \
 *   pnpm --filter @workspace/plaud-sync run-sync
 *
 * Last-sync tracking: reads/updates a JSON file at PLAUD_SYNC_STATE (default:
 * /tmp/plaud-sync-state.json) that stores { repId: lastSyncIso }.
 */
import { SvlClient } from "./svl-client";
import { syncRep, type SyncRepResult } from "./sync";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function parseRepConfigs(raw: string): Array<{ repId: string; tokenDir: string }> {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx < 0) throw new Error(`Invalid PLAUD_REPS entry: ${entry} (expected repId:/token/dir)`);
      return {
        repId: entry.slice(0, colonIdx),
        tokenDir: entry.slice(colonIdx + 1),
      };
    });
}

interface SyncState {
  [repId: string]: string; // lastSyncIso
}

function loadState(path: string): SyncState {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(path: string, state: SyncState): void {
  writeFileSync(path, JSON.stringify(state, null, 2));
}

async function main(): Promise<void> {
  const baseUrl =
    process.env.HERMES_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:8080";
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) throw new Error("AGENT_API_KEY is required");

  const repsRaw = process.env.PLAUD_REPS;
  if (!repsRaw) throw new Error("PLAUD_REPS is required (format: repId:/token/dir,...)");

  const reps = parseRepConfigs(repsRaw);
  if (reps.length === 0) throw new Error("No reps configured");

  const statePath = process.env.PLAUD_SYNC_STATE ?? "/tmp/plaud-sync-state.json";
  const state = loadState(statePath);

  const svl = new SvlClient({ baseUrl, apiKey });
  const now = new Date();
  const results: SyncRepResult[] = [];
  let totalProcessed = 0;
  let totalVisits = 0;

  for (const rep of reps) {
    const lastSync = state[rep.repId] ?? null;
    console.error(`Syncing ${rep.repId} (lastSync: ${lastSync ?? "never"})...`);

    const result = await syncRep({
      svl,
      repId: rep.repId,
      tokenDir: rep.tokenDir,
      lastSync,
      now,
    });
    results.push(result);
    totalProcessed += result.processed;

    for (const rec of result.recordings) {
      if (rec.outcome === "visit_created") totalVisits++;
    }

    // Update sync state for this rep
    state[rep.repId] = now.toISOString();
    saveState(statePath, state);
  }

  console.log(JSON.stringify({
    ranAt: now.toISOString(),
    totalReps: results.length,
    totalProcessed,
    totalVisits,
    reps: results,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
