import express, { Router, type IRouter } from "express";
import { db, agentEventReceiptsTable, agentRunsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  WebhookEnvelope,
  verifySignature,
  SIGNATURE_HEADER,
  EVENT_ID_HEADER,
  TIMESTAMP_HEADER,
} from "../lib/webhook-envelope";

/**
 * Inbound canonical-event receiver: POST /webhooks/sales-outreach-events
 *
 * Deterministic ingestion only — verify, dedupe, persist, queue. No AI here.
 *
 *  1. HMAC (sha256=<hex> of the RAW body, HERMES_WEBHOOK_SECRET) must verify.
 *  2. Timestamp header must be within ±5 minutes (replay protection).
 *  3. Envelope must parse as a canonical event.
 *  4. eventId is deduped via agent_event_receipts — a duplicate returns
 *     200 {duplicate:true} and does nothing else.
 *  5. A fresh event creates an agent_runs row with status "queued".
 *
 * Mounted BEFORE express.json() so the raw body is available for HMAC.
 */
const router: IRouter = Router();

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

router.post(
  "/webhooks/sales-outreach-events",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res): Promise<void> => {
    const secret = process.env.HERMES_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Webhook receiver not configured (HERMES_WEBHOOK_SECRET missing)" });
      return;
    }

    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

    if (!verifySignature(rawBody, req.get(SIGNATURE_HEADER), secret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const ts = Number(req.get(TIMESTAMP_HEADER));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TIMESTAMP_TOLERANCE_SECONDS) {
      res.status(401).json({ error: "Stale or missing timestamp" });
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Body is not valid JSON" });
      return;
    }

    const parsed = WebhookEnvelope.safeParse(json);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const envelope = parsed.data;

    const headerEventId = req.get(EVENT_ID_HEADER);
    if (headerEventId && headerEventId !== envelope.eventId) {
      res.status(400).json({ error: "Header eventId does not match envelope" });
      return;
    }

    // Idempotency: first insert wins; conflict means we've seen this eventId.
    const inserted = await db
      .insert(agentEventReceiptsTable)
      .values({
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        payload: envelope,
      })
      .onConflictDoNothing({ target: agentEventReceiptsTable.eventId })
      .returning({ id: agentEventReceiptsTable.id });

    if (inserted.length === 0) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const [run] = await db
      .insert(agentRunsTable)
      .values({
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        correlationId: envelope.correlationId ?? null,
        status: "queued",
      })
      .returning();

    logger.info(
      { eventId: envelope.eventId, eventType: envelope.eventType, agentRunId: run.id },
      "canonical event accepted",
    );

    res.status(200).json({ ok: true, duplicate: false, agentRunId: run.id });
  },
);

export default router;
