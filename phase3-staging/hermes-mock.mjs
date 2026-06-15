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
 * Verifies the SAME contract as the inbound receiver:
 *   HMAC-SHA256 over `${x-hermes-timestamp}.${rawBody}` == `x-hermes-signature` (sha256=<hex>),
 *   timestamp within ±5 min.
 */
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.HERMES_WEBHOOK_SECRET;
const PORT = Number(process.env.MOCK_PORT || 4505);
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

if (!SECRET) {
  console.error("HERMES_WEBHOOK_SECRET is required (must match the app's secret).");
  process.exit(1);
}

function signPayload(secret, signed) {
  return "sha256=" + createHmac("sha256", secret).update(signed, "utf8").digest("hex");
}
function verify(secret, signed, candidate) {
  if (!candidate) return false;
  const a = Buffer.from(signPayload(secret, signed), "utf8");
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
    const sig = req.headers["x-hermes-signature"];
    const ts = req.headers["x-hermes-timestamp"];
    const eventId = req.headers["x-hermes-event-id"];

    const sigOk = verify(SECRET, `${ts}.${raw}`, sig);
    const fresh = ts && Number.isFinite(Number(ts)) && Math.abs(Date.now() - Number(ts)) <= REPLAY_WINDOW_MS;
    let env = null, parseOk = false;
    try { env = JSON.parse(raw); parseOk = true; } catch { /* noop */ }

    n += 1;
    const ok = sigOk && fresh && parseOk;
    console.log(`\n[#${n}] ${req.url}  ${ok ? "PASS ✅" : "FAIL ❌"}`);
    console.log(`  signature: ${sigOk ? "valid" : "INVALID"}   timestamp: ${fresh ? "fresh" : "STALE"}   json: ${parseOk ? "ok" : "UNPARSEABLE"}`);
    console.log(`  x-hermes-event-id: ${eventId}`);
    if (env) {
      console.log(`  envelope: version=${env.version} type=${env.eventType} eventId=${env.eventId} businessId=${env.businessId ?? "null"} occurredAt=${env.occurredAt}`);
      if (env.data && Object.keys(env.data).length) console.log(`  data: ${JSON.stringify(env.data)}`);
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
