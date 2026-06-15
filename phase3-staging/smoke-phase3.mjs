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
 *   AGENT_API_KEY         required for the /api/agent/* checks (else skipped)
 *   HERMES_WEBHOOK_SECRET required for the inbound /api/webhooks/hermes checks (else skipped)
 *   SMOKE_WRITE=1         also exercise the agent write path (creates/updates one test suggestion)
 *
 * Signing mirrors repo-overlay/artifacts/api-server/src/lib/webhooks.ts exactly:
 *   HMAC-SHA256 over `${timestamp}.${rawBody}`, header `x-hermes-signature: sha256=<hex>`,
 *   `x-hermes-timestamp: <ms epoch>`, ±5 min replay window.
 */
import { createHmac } from "node:crypto";

const PORT = process.env.PORT || "3000";
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const AGENT_API_KEY = process.env.AGENT_API_KEY || "";
const SECRET = process.env.HERMES_WEBHOOK_SECRET || "";
const DO_WRITE = process.env.SMOKE_WRITE === "1";

let passed = 0, failed = 0, skipped = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log("  ok   -", name); }
  else { failed++; console.error("  FAIL -", name, detail ? `(${detail})` : ""); }
}
function skip(name, why) { skipped++; console.log("  skip -", name, `(${why})`); }

function signPayload(secret, signed) {
  return "sha256=" + createHmac("sha256", secret).update(signed, "utf8").digest("hex");
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
    version: "2026-06-12",
    eventId: over.eventId ?? `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: "visit.created",
    occurredAt: new Date().toISOString(),
    source: "hermes",
    businessId: 1,
    data: { note: "phase3 smoke" },
    ...over,
  };
}

async function postInbound(bodyObjOrStr, { timestamp, badSig = false } = {}) {
  const raw = typeof bodyObjOrStr === "string" ? bodyObjOrStr : JSON.stringify(bodyObjOrStr);
  const ts = timestamp ?? Date.now().toString();
  const sig = badSig ? "sha256=deadbeef" : signPayload(SECRET, `${ts}.${raw}`);
  return http("POST", "/api/webhooks/hermes", {
    headers: { "content-type": "application/json", "x-hermes-signature": sig, "x-hermes-timestamp": ts },
    raw,
  });
}

console.log(`Phase 3 smoke — ${BASE}\n`);

const run = async () => {
  // ── reachability + app-facing reads ──────────────────────────────────────
  {
    const r = await http("GET", "/api/suggestions");
    check("GET /api/suggestions reachable (200)", r.status === 200, `status ${r.status}`);
    check("GET /api/suggestions returns a suggestions array",
      !!r.json && Array.isArray(r.json.suggestions), JSON.stringify(r.json));
  }
  {
    const r = await http("GET", "/api/insights/prospect?businessId=1");
    check("GET /api/insights/prospect (200 + insights array)",
      r.status === 200 && !!r.json && Array.isArray(r.json.insights), `status ${r.status}`);
  }

  // ── agent auth (requireAgentKey) ─────────────────────────────────────────
  {
    const r = await http("GET", "/api/agent/events");
    check("GET /api/agent/events without Bearer -> 401", r.status === 401, `status ${r.status}`);
  }
  if (!AGENT_API_KEY) {
    skip("agent authed checks", "AGENT_API_KEY not set");
  } else {
    const auth = { Authorization: `Bearer ${AGENT_API_KEY}` };
    {
      const r = await http("GET", "/api/agent/events", { headers: auth });
      check("GET /api/agent/events with Bearer -> 200 + events array",
        r.status === 200 && !!r.json && Array.isArray(r.json.events), `status ${r.status}`);
    }
    {
      const r = await http("GET", "/api/agent/context?businessId=1", { headers: auth });
      const k = r.json || {};
      check("GET /api/agent/context -> 200 with full bundle keys",
        r.status === 200 && "business" in k && Array.isArray(k.visits) &&
        Array.isArray(k.notes) && Array.isArray(k.insights) && Array.isArray(k.suggestions),
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
      const stale = (Date.now() - 6 * 60 * 1000).toString(); // 6 min old
      const r = await postInbound(envelope(), { timestamp: stale });
      check("inbound stale timestamp -> 401 stale_timestamp",
        r.status === 401 && r.json?.error === "stale_timestamp", `status ${r.status} ${r.text}`);
    }
    {
      const r = await postInbound(envelope(), { badSig: true });
      check("inbound bad signature -> 401 invalid_signature",
        r.status === 401 && r.json?.error === "invalid_signature", `status ${r.status} ${r.text}`);
    }
    {
      // correctly signed, but envelope has a STRING businessId -> envelope parse 400
      const r = await postInbound(envelope({ businessId: "abc" }));
      check("inbound string entity id -> 400 invalid_envelope",
        r.status === 400 && r.json?.error === "invalid_envelope", `status ${r.status} ${r.text}`);
    }
    const sharedId = `smoke-dup-${Date.now()}`;
    {
      const r = await postInbound(envelope({ eventId: sharedId }));
      check("inbound valid -> 200 queued:true (+runId)",
        r.status === 200 && r.json?.queued === true && r.json?.runId != null, `status ${r.status} ${r.text}`);
    }
    {
      const r = await postInbound(envelope({ eventId: sharedId })); // same eventId, fresh ts+sig
      check("inbound replay same eventId -> 200 duplicate:true",
        r.status === 200 && r.json?.duplicate === true, `status ${r.status} ${r.text}`);
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
        body: { businessId: 1, type: "smoke", title: "Phase 3 smoke suggestion", priority: "medium", dedupeKey },
      });
      suggestionId = r.json?.suggestion?.id ?? null;
      check("POST /api/agent/suggestions -> 200/201 (+ priority medium->normal)",
        (r.status === 200 || r.status === 201) && r.json?.suggestion?.priority === "normal",
        `status ${r.status} ${r.text}`);
    }
    if (suggestionId != null) {
      const r = await http("PATCH", `/api/suggestions/${suggestionId}`, {
        headers: { "content-type": "application/json" }, body: { status: "read" },
      });
      check("PATCH /api/suggestions/:id status:read -> 200",
        r.status === 200 && r.json?.suggestion?.status === "read", `status ${r.status} ${r.text}`);
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
