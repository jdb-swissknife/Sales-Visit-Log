/**
 * Inbound signed webhook receiver from Hermes (R3).
 *
 *   POST /api/webhooks/hermes
 *
 * Pipeline: raw-body HMAC verify → ±5 min replay window → envelope parse (clean 400
 * on bad/string IDs) → eventId idempotency dedupe → record receipt + queue an
 * `agent_runs` row (status:"queued"). No LLM work here — Hermes picks up the queued run.
 *
 * ── CRITICAL mounting requirement ────────────────────────────────────────────
 *  This router uses `express.raw(...)` so it sees the unparsed body for HMAC. It MUST
 *  be registered BEFORE any global `express.json()` in the server entry, otherwise the
 *  JSON parser consumes the stream and the raw bytes (and signature validity) are lost.
 *  See ACTIVATION.md → "R3 registration".
 *
 * ── Signature contract (must match outbound webhooks.ts) ─────────────────────
 *  Hermes signs: HMAC-SHA256 over `${timestamp}.${rawBody}`, sent as
 *  `x-hermes-signature: sha256=<hex>` with `x-hermes-timestamp: <ms epoch>`.
 *
 * ── ASSUMPTIONS to confirm at activation ─────────────────────────────────────
 *  A1. `db`, `agentEventReceiptsTable`, `agentRunsTable` exported from "@workspace/db".
 *  A2. Unique constraint on `agent_event_receipts.event_id` (R1) backs the dedupe race guard.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import express, { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, agentEventReceiptsTable, agentRunsTable } from "@workspace/db";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
  isFreshTimestamp,
} from "../lib/webhooks";
import { parseEnvelope } from "../lib/webhook-envelope";

const router: IRouter = Router();

// Raw body only for this router; `type` accepts any content-type so a mislabelled
// request still yields the bytes we need to verify.
router.post("/hermes", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  const secret = process.env.HERMES_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "inbound_webhooks_unconfigured" });
    return;
  }

  const signature = req.header(SIGNATURE_HEADER);
  const timestamp = req.header(TIMESTAMP_HEADER);

  // express.raw gives a Buffer; guard against a non-buffer (e.g. body already parsed upstream)
  const rawBody = Buffer.isBuffer(req.body) ? (req.body as Buffer).toString("utf8") : "";

  // 1. replay window (±5 min) — reject stale/early before spending a hash
  if (!isFreshTimestamp(timestamp)) {
    res.status(401).json({ error: "stale_timestamp", message: "timestamp outside replay window" });
    return;
  }

  // 2. signature
  if (!verifySignature(secret, `${timestamp}.${rawBody}`, signature)) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  // 3. parse JSON + envelope (clean 400 on string/float entity IDs etc.)
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  const parsed = parseEnvelope(json);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_envelope", message: parsed.message });
    return;
  }
  const env = parsed.envelope;

  // 4. idempotency dedupe (fast path)
  const existing = await db
    .select({ id: agentEventReceiptsTable.id })
    .from(agentEventReceiptsTable)
    .where(eq(agentEventReceiptsTable.eventId, env.eventId))
    .limit(1);
  if (existing.length > 0) {
    res.status(200).json({ duplicate: true });
    return;
  }

  // 5. record receipt — unique(event_id) is the authoritative race guard
  try {
    await db.insert(agentEventReceiptsTable).values({
      eventId: env.eventId,
      eventType: env.eventType,
      source: env.source ?? "hermes",
      correlationId: env.correlationId ?? null,
      repId: env.repId ?? null,
      businessId: env.businessId ?? null,
      payload: env as unknown as Record<string, unknown>,
      processingStatus: "received",
    });
  } catch (err) {
    // unique violation → another concurrent delivery won the race
    if (isUniqueViolation(err)) {
      res.status(200).json({ duplicate: true });
      return;
    }
    throw err;
  }

  // 6. queue an agent_runs row for Hermes to pick up
  const [run] = await db
    .insert(agentRunsTable)
    .values({
      eventId: env.eventId,
      eventType: env.eventType,
      runType: "webhook",
      status: "queued",
      repId: env.repId ?? null,
      businessId: env.businessId ?? null,
      correlationId: env.correlationId ?? null,
      reason: "inbound webhook",
    })
    .returning({ id: agentRunsTable.id });

  res.status(200).json({ queued: true, runId: run?.id, eventId: env.eventId });
});

/** Postgres unique-violation detector (pg error code 23505), driver-agnostic. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505" || code === 23505;
}

export default router;
