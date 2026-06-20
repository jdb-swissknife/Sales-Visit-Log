/**
 * One-shot CLI: run the nearby_prospect behavior once against the API.
 *
 *   HERMES_BASE_URL=http://localhost:8080 \
 *   AGENT_API_KEY=... HERMES_REP_ID=rep-7 \
 *   pnpm --filter @workspace/hermes-agent run-nearby
 */
import { HermesClient } from "./client";
import { runNearbyProspect } from "./nearby-prospect";

async function main(): Promise<void> {
  const baseUrl =
    process.env.HERMES_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:8080";
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) throw new Error("AGENT_API_KEY is required");

  const client = new HermesClient({ baseUrl, apiKey });
  const result = await runNearbyProspect({
    client,
    repId: process.env.HERMES_REP_ID,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
