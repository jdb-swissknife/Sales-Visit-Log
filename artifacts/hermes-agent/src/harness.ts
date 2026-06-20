/**
 * Multi-rep scheduling harness for Hermes behaviors.
 *
 * The harness is the layer that turns a single-rep behavior (runNearbyProspect)
 * into the team-wide, scheduled job that actually exercises the rep-scoped feed.
 * It is deliberately a one-shot: it runs every active rep once and returns. An
 * external scheduler (cron) invokes it on a cadence; the behavior's own drop-in
 * time gate and per-day dedupeKey make frequent invocation safe (no stacking).
 *
 * Per-rep location is NOT passed in: runNearbyProspect derives each rep's anchor
 * from that rep's most recent visit via GET /agent/events?repId=, so two reps
 * run together get independent anchors as long as the server scopes the feed by
 * repId (which it now does).
 *
 * Run tracking: for each rep the harness opens a tracked run (POST /agent/runs)
 * and hands the id to runNearbyProspect, which walks the lifecycle
 * (running -> completed/skipped/failed) via PATCH /agent/runs/:id.
 */
import type { HermesClient } from "./client";
import { runNearbyProspect, type RunNearbyResult } from "./nearby-prospect";
import type { NearbyConfig } from "./proximity";

export interface HarnessOptions {
  client: HermesClient;
  /** Active reps to run this tick. */
  repIds: string[];
  /** Defaults to now; injectable for deterministic runs/tests. */
  now?: Date;
  config?: Partial<NearbyConfig>;
  /**
   * When false (default), the harness opens a tracked agent_run per rep via
   * POST /agent/runs and reports its lifecycle. Set true to skip run tracking
   * (suggestions still post; no agent_runs row is created).
   */
  skipRunTracking?: boolean;
}

export interface HarnessRepOutcome {
  repId: string;
  /** Tracked run id, when run tracking is on and run creation succeeded. */
  agentRunId?: number;
  result?: RunNearbyResult;
  /** Set when this rep's run threw; other reps are unaffected. */
  error?: string;
}

export interface HarnessResult {
  ranAt: string;
  reps: HarnessRepOutcome[];
  totalPosted: number;
}

/**
 * Run the nearby_prospect behavior once for every active rep. Per-rep failures
 * are isolated: one rep throwing never aborts the others, and the harness itself
 * does not throw for a field error — it records it on that rep's outcome.
 */
export async function runHarness(opts: HarnessOptions): Promise<HarnessResult> {
  const now = opts.now ?? new Date();
  const reps: HarnessRepOutcome[] = [];
  let totalPosted = 0;

  for (const repId of opts.repIds) {
    const outcome: HarnessRepOutcome = { repId };
    try {
      let agentRunId: number | undefined;
      if (!opts.skipRunTracking) {
        // Run creation is part of the rep's run; if it fails, fall back to an
        // untracked run rather than dropping the rep entirely.
        try {
          const created = await opts.client.createRun({
            eventType: "nearby_prospect.scheduled",
            eventId: `hermes:nearby:${repId}:${now.toISOString()}`,
          });
          agentRunId = created.id;
          outcome.agentRunId = agentRunId;
        } catch (err) {
          outcome.error = `createRun failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }

      const result = await runNearbyProspect({
        client: opts.client,
        repId,
        now,
        config: opts.config,
        agentRunId,
      });
      outcome.result = result;
      totalPosted += result.posted;
    } catch (err) {
      outcome.error = err instanceof Error ? err.message : String(err);
    }
    reps.push(outcome);
  }

  return { ranAt: now.toISOString(), reps, totalPosted };
}

/** Parse a comma/whitespace-separated rep-id list (e.g. from an env var). */
export function parseRepIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
