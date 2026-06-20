/** Deterministic e2e driver: runs the behavior once with a fixed `now`. */
import { HermesClient } from "../src/client";
import { runNearbyProspect } from "../src/nearby-prospect";

const client = new HermesClient({
  baseUrl: process.env.HERMES_BASE_URL ?? "http://localhost:8080",
  apiKey: process.env.AGENT_API_KEY ?? "",
});
const now = new Date(process.env.HERMES_NOW ?? new Date().toISOString());

runNearbyProspect({ client, repId: process.env.HERMES_REP_ID ?? "rep-7", now })
  .then((r) => {
    console.log("RESULT " + JSON.stringify(r));
  })
  .catch((e) => {
    console.error("ERR " + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
