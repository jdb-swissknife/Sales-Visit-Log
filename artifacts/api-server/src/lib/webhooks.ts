import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, businessesTable, visitsTable } from "@workspace/db";
import { logger } from "./logger";
import {
  WEBHOOK_VERSION,
  CANONICAL_EVENT_TYPES,
  signBody,
  SIGNATURE_HEADER,
  EVENT_HEADER,
  EVENT_ID_HEADER,
  TIMESTAMP_HEADER,
  VERSION_HEADER,
  type CanonicalEventType,
  type WebhookEnvelopeType,
} from "./webhook-envelope";

/**
 * Outbound webhooks → Hermes, using the canonical envelope.
 *
 * Env:
 *   HERMES_WEBHOOK_URL     — Hermes's endpoint. Unset = webhooks disabled (no-op).
 *   HERMES_WEBHOOK_SECRET  — optional; raw body is HMAC-SHA256 signed into
 *                            `X-Outreach-Signature` as `sha256=<hex>`.
 *   APP_BASE_URL           — used to build deep links in `links`.
 *
 * Fire-and-forget with one retry; never throws into the request path.
 */

const CANONICAL_SET = new Set<string>(CANONICAL_EVENT_TYPES);

export function shouldWebhook(eventType: string): boolean {
  return CANONICAL_SET.has(eventType);
}

export interface WebhookEventData {
  entityType?: string | null;
  entityId?: number | null;
  businessId?: number | null;
  visitId?: number | null;
  payload?: Record<string, unknown> | null;
}

async function buildEnvelope(
  eventType: CanonicalEventType,
  data: WebhookEventData,
): Promise<WebhookEnvelopeType> {
  const baseUrl = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  const payload = data.payload ?? {};

  let business: WebhookEnvelopeType["business"] = null;
  if (data.businessId != null) {
    try {
      const [row] = await db
        .select({
          id: businessesTable.id,
          name: businessesTable.name,
          address: businessesTable.address,
          status: businessesTable.status,
        })
        .from(businessesTable)
        .where(eq(businessesTable.id, data.businessId));
      if (row) business = row;
    } catch (err) {
      logger.warn({ err }, "webhook envelope: business lookup failed");
    }
  }

  let visit: WebhookEnvelopeType["visit"] = null;
  let callback: WebhookEnvelopeType["callback"] = null;
  if (data.visitId != null) {
    try {
      const [row] = await db
        .select({
          id: visitsTable.id,
          outcome: visitsTable.outcome,
          visitedAt: visitsTable.visitedAt,
          nextActionDate: visitsTable.nextActionDate,
        })
        .from(visitsTable)
        .where(eq(visitsTable.id, data.visitId));
      if (row) {
        visit = { id: row.id, outcome: row.outcome, visitedAt: row.visitedAt?.toISOString() };
        if (row.nextActionDate) {
          callback = { visitId: row.id, dueAt: row.nextActionDate.toISOString() };
        }
      }
    } catch (err) {
      logger.warn({ err }, "webhook envelope: visit lookup failed");
    }
  }

  const links: Record<string, string> = {};
  if (baseUrl && data.businessId != null) links.business = `${baseUrl}/businesses/${data.businessId}`;
  if (baseUrl && data.visitId != null) links.visit = `${baseUrl}/visits/${data.visitId}`;

  return {
    version: WEBHOOK_VERSION,
    eventId: randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    source: "sales-outreach-app",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    correlationId: data.visitId != null ? `visit-${data.visitId}` : null,
    rep: null, // populated once team auth (Phase 1 backlog) lands
    business,
    visit,
    callback,
    media:
      eventType === "media.transcribed"
        ? {
            id: data.entityId ?? null,
            type: (payload.mediaType as string) ?? "audio",
            transcript: (payload.transcript as string) ?? null,
          }
        : null,
    daySummary: eventType === "day.ended" ? payload : null,
    appContext: { entityType: data.entityType ?? null, entityId: data.entityId ?? null, payload },
    links: Object.keys(links).length > 0 ? links : null,
  };
}

async function post(url: string, body: string, envelope: WebhookEnvelopeType): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [EVENT_HEADER]: envelope.eventType,
    [EVENT_ID_HEADER]: envelope.eventId,
    [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)),
    [VERSION_HEADER]: WEBHOOK_VERSION,
  };
  const secret = process.env.HERMES_WEBHOOK_SECRET;
  if (secret) headers[SIGNATURE_HEADER] = signBody(body, secret);
  return fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
}

export function sendWebhook(eventType: string, data: WebhookEventData): void {
  const url = process.env.HERMES_WEBHOOK_URL;
  if (!url || !shouldWebhook(eventType)) return;

  void (async () => {
    let body = "";
    let envelope: WebhookEnvelopeType;
    try {
      envelope = await buildEnvelope(eventType as CanonicalEventType, data);
      body = JSON.stringify(envelope);
    } catch (err) {
      logger.warn({ err, eventType }, "webhook envelope build failed");
      return;
    }
    try {
      const res = await post(url, body, envelope);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (firstErr) {
      await new Promise((r) => setTimeout(r, 5_000));
      try {
        const res = await post(url, body, envelope);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        logger.warn({ err, firstErr, eventType }, "Hermes webhook delivery failed");
      }
    }
  })();
}
