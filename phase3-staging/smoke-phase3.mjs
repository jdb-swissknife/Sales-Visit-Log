/**
 * Phase 3 live smoke test — INBOUND receiver + agent auth + app-facing reads.
 * Pure Node (>=18, global fetch). No build step. Run against a RUNNING server.
 *
 *   BASE_URL=http://localhost:5000 \
 *   AGENT_API_KEY=... HERMES_WEBHOOK_SECRET=... \
 *   node phase3-staging/smoke-phase3.mjs
 *
 * Env:
 *   BASE_URL              default http://localhost:${PORT:-3000}
 *   AGENT_API_KEY         required for the /api/agent/* authed checks (else skipped)
 *   HERMES_WEBHOOK_SECRET required for the inbound receiver checks (else skipped)
 *   SMOKE_WRITE=1         also exercise the agent write path (creates/updates one test suggestion)
 *
 * Topology + signing mirror the SHIPPED app/ tree exactly
 * (artifacts/api-server/src/lib/webhook-envelope.ts + routes/webhooks-inbound.ts):
 *   - inbound route:  POST /webhooks/sales-outreach-events   (mounted at root, before express.json)
 *   - signature:      x-outreach-signature: sha256=<hex of the RAW body only>  (no ts prefix)
 *   - timestamp:      x-outreach-timestamp: <unix SECONDS>, ±5 min replay window
 *   - other headers:  x-outreach-event, x-outreach-event-id, x-outreach-version
 *   - envelope:       { version:"1", eventId, eventType(enum), occurredAt, source, environment, ... }
 */
import { createHmac } from "node:crypto";

const PORT = process.env.PORT || "3000";
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const AGENT_API_KEY = process.env.AGENT_API_KEY || "";
const SECRET = process.env.HERMES_WEBHOOK_SECRET || "";
const DO_WRITE = process.env.SMOKE_WRITE === "1";

const WEBHOOK_VERSION = "1";
const INBOUND_PATH = "/webhooks/sales-outreach-events";

let passed = 0, failed = 0, skipped = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log("  ok   -", name); }
  else { failed++; console.error("  FAIL -", name, detail ? `(${detail})` : ""); }
}
function skip(name, why) { skipped++; console.log("  skip -", name, `(${why})`); }

/** sha256=<hex> HMAC over the RAW body only — matches signBody() in webhook-envelope.ts. */
function signBody(secret, raw) {
  return "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

async function http(method, path, { headers = {}, body, raw } = {}) {
  const res = await fetch(BASE + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, json, text };
}

function envelope(over = {}) {
  return {
    version: WEBHOOK_VERSION,
    eventId: over.eventId ?? `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: "visit.created",
    occurredAt: new Date().toISOString(),
    source: "hermes-smoke",
    environment: "test",
    correlationId: null,
    ...over,
  };
}

async function postInbound(envObj, { timestamp, badSig = false } = {}) {
  const raw = typeof envObj === "string" ? envObj : JSON.stringify(envObj);
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString();
  const sig = badSig ? "sha256=deadbeef" : signBody(SECRET, raw);
  const headers = {
    "content-type": "application/json",
    "x-outreach-signature": sig,
    "x-outreach-timestamp": ts,
    "x-outreach-version": WEBHOOK_VERSION,
  };
  // Mirror the real sender: include event + event-id headers when we have them.
  if (typeof envObj === "object" && envObj) {
    if (envObj.eventType) headers["x-outreach-event"] = envObj.eventType;
    if (envObj.eventId) headers["x-outreach-event-id"] = envObj.eventId;
  }
  return http("POST", INBOUND_PATH, { headers, raw });
}

console.log(`Phase 3 smoke — ${BASE}\n`);

const run = async () => {
  // ── app-facing reads ─────────────────────────────────────────────────────
  {
    const r = await http("GET", "/api/suggestions");
    check("GET /api/suggestions -> 200", r.status === 200, `status ${r.status}`);
    check("GET /api/suggestions returns an array", Array.isArray(r.json), JSON.stringify(r.json));
  }

  // ── agent auth (requireAgentKey) ─────────────────────────────────────────
  {
    // 401 when AGENT_API_KEY is configured (the deployed case); 503 if the server
    // has no key set yet. Either way, an unauthenticated request must be rejected.
    const r = await http("GET", "/api/agent/events");
    check("GET /api/agent/events without Bearer -> rejected (401/503)",
      r.status === 401 || r.status === 503, `status ${r.status}`);
  }
  if (!AGENT_API_KEY) {
    skip("agent authed checks", "AGENT_API_KEY not set");
  } else {
    const auth = { Authorization: `Bearer ${AGENT_API_KEY}` };
    {
      const r = await http("GET", "/api/agent/events", { headers: auth });
      check("GET /api/agent/events with Bearer -> 200 + array",
        r.status === 200 && Array.isArray(r.json), `status ${r.status}`);
    }
    {
      const r = await http("GET", "/api/agent/context", { headers: auth });
      const k = r.json || {};
      check("GET /api/agent/context -> 200 with {businesses, upcomingCallbacks, generatedAt}",
        r.status === 200 && Array.isArray(k.businesses) && Array.isArray(k.upcomingCallbacks) &&
        typeof k.generatedAt === "string",
        `status ${r.status} keys ${Object.keys(k)}`);
    }
    {
      const r = await http("GET", "/api/agent/events?since=not-a-date", { headers: auth });
      check("GET /api/agent/events?since=garbage -> 400", r.status === 400, `status ${r.status}`);
    }
  }

  // ── inbound signed receiver ──────────────────────────────────────────────
  if (!SECRET) {
    skip("inbound webhook checks", "HERMES_WEBHOOK_SECRET not set");
  } else {
    {
      const stale = (Math.floor(Date.now() / 1000) - 6 * 60).toString(); // 6 min old, seconds
      const r = await postInbound(envelope(), { timestamp: stale });
      check("inbound stale timestamp -> 401", r.status === 401, `status ${r.status} ${r.text}`);
    }
    {
      const r = await postInbound(envelope(), { badSig: true });
      check("inbound bad signature -> 401", r.status === 401, `status ${r.status} ${r.text}`);
    }
    {
      // Correctly signed + fresh, but an invalid eventType fails envelope parse -> 400.
      const r = await postInbound(envelope({ eventType: "not.a.real.event" }));
      check("inbound invalid envelope -> 400", r.status === 400, `status ${r.status} ${r.text}`);
    }
    const sharedId = `smoke-dup-${Date.now()}`;
    {
      const r = await postInbound(envelope({ eventId: sharedId }));
      check("inbound valid -> 200 ok:true duplicate:false (+agentRunId)",
        r.status === 200 && r.json?.ok === true && r.json?.duplicate === false && r.json?.agentRunId != null,
        `status ${r.status} ${r.text}`);
    }
    {
      const r = await postInbound(envelope({ eventId: sharedId })); // same eventId, fresh ts+sig
      check("inbound replay same eventId -> 200 duplicate:true",
        r.status === 200 && r.json?.ok === true && r.json?.duplicate === true,
        `status ${r.status} ${r.text}`);
    }
  }

  // ── agent write round-trip (opt-in: mutates the DB) ──────────────────────
  if (DO_WRITE && AGENT_API_KEY) {
    const auth = { Authorization: `Bearer ${AGENT_API_KEY}`, "content-type": "application/json" };
    const dedupeKey = "smoke-test-suggestion"; // stable so re-runs upsert instead of pile up
    let suggestionId = null;
    {
      const r = await http("POST", "/api/agent/suggestions", {
        headers: auth,
        body: {
          businessId: 1,
          type: "other",
          title: "Phase 3 smoke suggestion",
          body: "Created by smoke-phase3.mjs — safe to dismiss.",
          priority: "normal",
          dedupeKey,
        },
      });
      suggestionId = r.json?.id ?? null;
      check("POST /api/agent/suggestions -> 200/201 (+ row with id)",
        (r.status === 200 || r.status === 201) && r.json?.id != null && r.json?.priority === "normal",
        `status ${r.status} ${r.text}`);
    }
    if (suggestionId != null) {
      const r = await http("PATCH", `/api/suggestions/${suggestionId}`, {
        headers: { "content-type": "application/json" }, body: { status: "read" },
      });
      check("PATCH /api/suggestions/:id status:read -> 200",
        r.status === 200 && r.json?.status === "read", `status ${r.status} ${r.text}`);
    }
  } else if (DO_WRITE) {
    skip("agent write round-trip", "AGENT_API_KEY not set");
  } else {
    skip("agent write round-trip", "set SMOKE_WRITE=1 to enable (mutates DB)");
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error("\nSmoke run crashed:", err?.message || err);
  console.error(`Is the server up at ${BASE}? Set BASE_URL/PORT if not.`);
  process.exit(2);
});
