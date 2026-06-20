/**
 * One-shot CLI: run the nearby_prospect harness once for every active rep.
 * Intended to be invoked on a schedule by an external cron.
 *
 *   HERMES_BASE_URL=http://localhost:8080 \
 *   AGENT_API_KEY=... HERMES_REP_IDS=rep-7,rep-9 \
 *   pnpm --filter @workspace/hermes-agent run-harness
 *
 * Rep list source is config for now (HERMES_REP_IDS). Once team auth lands the
 * intended source is a GET /api/agent/reps context endpoint; see APPLY notes.
 */
import { HermesClient } from "./client";
import { runHarness, parseRepIds } from "./harness";

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
  const result = await runHarness({ client, repIds });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
