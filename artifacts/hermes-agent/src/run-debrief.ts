/**
 * One-shot CLI: run the debrief behavior once for every active rep. Intended to
 * be invoked by an external scheduler shortly after reps typically end their
 * day. Per-rep run tracking and failure isolation mirror run-harness; the
 * per-day dedupeKey makes repeated invocation safe (no stacking).
 *
 *   HERMES_BASE_URL=http://localhost:8080 \
 *   AGENT_API_KEY=... HERMES_REP_IDS=rep-7,rep-9 \
 *   pnpm --filter @workspace/hermes-agent run-debrief
 *
 * Rep list source is config for now (HERMES_REP_IDS); the future source is a
 * GET /api/agent/reps endpoint once team auth lands (same as run-harness).
 */
import { HermesClient } from "./client";
import { parseRepIds } from "./harness";
import { runDebrief, type RunDebriefResult } from "./debrief";

interface RepOutcome {
  repId: string;
  agentRunId?: number;
  result?: RunDebriefResult;
  error?: string;
}

async function main(): Promise<void> {
  const baseUrl =
    process.env.HERMES_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:8080";
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) throw new Error("AGENT_API_KEY is required");

  const repIds = parseRepIds(process.env.HERMES_REP_IDS);
  if (repIds.length === 0) {
    throw new Error("HERMES_REP_IDS is required (comma-separated rep ids)");
  }

  const client = new HermesClient({ baseUrl, apiKey });
  const now = new Date();
  const reps: RepOutcome[] = [];
  let totalPosted = 0;

  for (const repId of repIds) {
    const outcome: RepOutcome = { repId };
    try {
      let agentRunId: number | undefined;
      try {
        const created = await client.createRun({
          eventType: "debrief.scheduled",
          eventId: `hermes:debrief:${repId}:${now.toISOString()}`,
        });
        agentRunId = created.id;
        outcome.agentRunId = agentRunId;
      } catch (err) {
        // Fall back to an untracked run rather than dropping the rep.
        outcome.error = `createRun failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      const result = await runDebrief({ client, repId, now, agentRunId });
      outcome.result = result;
      totalPosted += result.posted;
    } catch (err) {
      outcome.error = err instanceof Error ? err.message : String(err);
    }
    reps.push(outcome);
  }

  console.log(
    JSON.stringify({ ranAt: now.toISOString(), reps, totalPosted }, null, 2),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
