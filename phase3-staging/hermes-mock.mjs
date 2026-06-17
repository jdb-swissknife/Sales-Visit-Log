/**
 * Hermes mock receiver — validates the OUTBOUND webhook path end-to-end.
 * Pure Node (>=18). No build step. Stands in for the real Hermes endpoint so you can
 * prove the app signs + delivers a correct envelope when an app event is logged.
 *
 *   HERMES_WEBHOOK_SECRET=... MOCK_PORT=4505 node phase3-staging/hermes-mock.mjs
 *
 * Then point the APP at it and restart the app so it picks up the env:
 *   HERMES_WEBHOOK_URL=http://localhost:4505/hermes
 *   HERMES_WEBHOOK_SECRET=<same secret as here>
 * Trigger any app action that calls logEvent (e.g. create a visit). Each delivery prints
 * a PASS/FAIL line: signature validity, replay-window freshness, and the parsed envelope.
 *
 * Verifies the SAME contract as the SHIPPED sender (lib/webhooks.ts + webhook-envelope.ts):
 *   x-outreach-signature = sha256=<hex of the RAW body only>   (NO timestamp prefix)
 *   x-outreach-timestamp = unix SECONDS, within ±5 min
 *   x-outreach-event / x-outreach-event-id / x-outreach-version also sent
 */
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.HERMES_WEBHOOK_SECRET;
const PORT = Number(process.env.MOCK_PORT || 4505);
const REPLAY_WINDOW_SECONDS = 5 * 60;

if (!SECRET) {
  console.error("HERMES_WEBHOOK_SECRET is required (must match the app's secret).");
  process.exit(1);
}

/** sha256=<hex> HMAC over the RAW body only — matches signBody() in webhook-envelope.ts. */
function signBody(secret, raw) {
  return "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}
function verify(secret, raw, candidate) {
  if (!candidate) return false;
  const a = Buffer.from(signBody(secret, raw), "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let n = 0;
const server = http.createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const sig = req.headers["x-outreach-signature"];
    const ts = req.headers["x-outreach-timestamp"];
    const eventId = req.headers["x-outreach-event-id"];

    const sigOk = verify(SECRET, raw, sig);
    const tsNum = Number(ts);
    const fresh = ts && Number.isFinite(tsNum) && Math.abs(Date.now() / 1000 - tsNum) <= REPLAY_WINDOW_SECONDS;
    let env = null, parseOk = false;
    try { env = JSON.parse(raw); parseOk = true; } catch { /* noop */ }

    n += 1;
    const ok = sigOk && fresh && parseOk;
    console.log(`\n[#${n}] ${req.url}  ${ok ? "PASS ✅" : "FAIL ❌"}`);
    console.log(`  signature: ${sigOk ? "valid" : "INVALID"}   timestamp: ${fresh ? "fresh" : "STALE"}   json: ${parseOk ? "ok" : "UNPARSEABLE"}`);
    console.log(`  x-outreach-event-id: ${eventId}`);
    if (env) {
      const bizId = env.business?.id ?? "null";
      console.log(`  envelope: version=${env.version} type=${env.eventType} eventId=${env.eventId} business.id=${bizId} occurredAt=${env.occurredAt}`);
      if (env.appContext && Object.keys(env.appContext).length) console.log(`  appContext: ${JSON.stringify(env.appContext)}`);
    }

    // Respond like a healthy Hermes so the app logs a successful delivery.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(PORT, () => {
  console.log(`Hermes mock listening on http://localhost:${PORT}  (POST /hermes)`);
  console.log("Point the app at this URL, restart it, then trigger an app event.\n");
});
