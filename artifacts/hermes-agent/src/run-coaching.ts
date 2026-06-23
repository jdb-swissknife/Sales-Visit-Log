/**
 * One-shot CLI: run the coaching behavior once for every active rep. Intended
 * to be invoked by an external scheduler on a weekly (or semi-weekly) cadence.
 * Per-rep run tracking and failure isolation mirror run-debrief / run-harness;
 * the per-week dedupeKey makes repeated invocation safe (no stacking).
 *
 *   HERMES_BASE_URL=http://localhost:8080 \
 *   AGENT_API_KEY=... HERMES_REP_IDS=rep-7,rep-9 \
 *   pnpm --filter @workspace/hermes-agent run-coaching
 */
import { HermesClient } from "./client";
import { parseRepIds } from "./harness";
import { runCoaching, type RunCoachingResult } from "./coaching";

interface RepOutcome {
  repId: string;
  agentRunId?: number;
  result?: RunCoachingResult;
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
          eventType: "coaching.scheduled",
          eventId: `hermes:coaching:${repId}:${now.toISOString()}`,
        });
        agentRunId = created.id;
        outcome.agentRunId = agentRunId;
      } catch (err) {
        outcome.error = `createRun failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      const result = await runCoaching({ client, repId, now, agentRunId });
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
