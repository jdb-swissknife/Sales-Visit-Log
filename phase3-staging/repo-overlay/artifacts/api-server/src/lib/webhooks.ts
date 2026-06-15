/**
 * Outbound webhook delivery to Hermes (R2).
 *
 * Responsibilities:
 *   - buildEnvelope(): stamp WEBHOOK_VERSION + defaults onto an app event.
 *   - HMAC-SHA256 signing over `${timestamp}.${payload}` so the inbound receiver
 *     (R3) can verify the signature AND enforce a ±5 min replay window from the
 *     same signed timestamp.
 *   - fire-and-forget delivery with exactly one retry. Never throws into the
 *     caller (logEvent must not be blocked or broken by webhook failures).
 *   - no-op when HERMES_WEBHOOK_URL / HERMES_WEBHOOK_SECRET are unset, so Phase 2
 *     behaviour is unchanged until secrets are configured (R5 activation).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";
import {
  WebhookEnvelope,
  WEBHOOK_VERSION,
  type EnvelopeData,
} from "./webhook-envelope";

/** Header names shared by outbound delivery and the R3 inbound receiver. */
export const SIGNATURE_HEADER = "x-hermes-signature";
export const TIMESTAMP_HEADER = "x-hermes-timestamp";
export const EVENT_ID_HEADER = "x-hermes-event-id";

/** Max clock skew the inbound receiver will tolerate (kept here so both sides agree). */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

const DELIVERY_TIMEOUT_MS = 8000;

/** Minimal description of an app event; the rest is defaulted in buildEnvelope. */
export interface OutboundEvent {
  /** ULID/text idempotency key. */
  eventId: string;
  /** e.g. "visit.created", "media.transcribed", "day.ended". */
  eventType: string;
  /** Defaults to now() if omitted. */
  occurredAt?: string;
  repId?: number | null;
  businessId?: number | null;
  correlationId?: string | null;
  data?: EnvelopeData | Record<string, unknown>;
}

/** Stamp version + defaults and validate. Throws on a malformed event (programmer error). */
export function buildEnvelope(event: OutboundEvent): WebhookEnvelope {
  return WebhookEnvelope.parse({
    version: WEBHOOK_VERSION,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    source: "app",
    repId: event.repId ?? null,
    businessId: event.businessId ?? null,
    correlationId: event.correlationId ?? null,
    data: event.data ?? {},
  });
}

/**
 * Compute the signature header value for a signed string.
 * Format: `sha256=<hex>` over `${timestamp}.${payload}`.
 */
export function signPayload(secret: string, signedString: string): string {
  const hex = createHmac("sha256", secret).update(signedString, "utf8").digest("hex");
  return `sha256=${hex}`;
}

/** Constant-time signature comparison; tolerant of malformed/empty input. */
export function verifySignature(
  secret: string,
  signedString: string,
  candidate: string | undefined | null,
): boolean {
  if (!candidate) return false;
  const expected = signPayload(secret, signedString);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True if a signed timestamp (ms epoch as string) is within the replay window of now. */
export function isFreshTimestamp(timestamp: string | undefined | null, nowMs = Date.now()): boolean {
  if (!timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= REPLAY_WINDOW_MS;
}

interface DeliveryConfig {
  url: string;
  secret: string;
}

function readConfig(): DeliveryConfig | null {
  const url = process.env.HERMES_WEBHOOK_URL;
  const secret = process.env.HERMES_WEBHOOK_SECRET;
  if (!url || !secret) return null;
  return { url, secret };
}

async function postOnce(
  cfg: DeliveryConfig,
  envelope: WebhookEnvelope,
): Promise<{ ok: boolean; status?: number; error?: unknown }> {
  const payload = JSON.stringify(envelope);
  const timestamp = Date.now().toString();
  const signature = signPayload(cfg.secret, `${timestamp}.${payload}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: timestamp,
        [EVENT_ID_HEADER]: envelope.eventId,
        "user-agent": `sales-outreach-app/${WEBHOOK_VERSION}`,
      },
      body: payload,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire an event to Hermes. Fire-and-forget with one retry. Never throws — any
 * failure is logged and swallowed so the calling code path (logEvent) is safe.
 * Returns a promise the caller MAY await in tests, but production calls should
 * use `void sendWebhook(...)`.
 */
export async function sendWebhook(event: OutboundEvent): Promise<void> {
  const cfg = readConfig();
  if (!cfg) {
    logger.debug({ eventType: event.eventType }, "hermes webhook not configured — skipping outbound");
    return;
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = buildEnvelope(event);
  } catch (error) {
    logger.error({ err: error, eventType: event.eventType }, "failed to build webhook envelope — dropping");
    return;
  }

  // attempt 1
  let result = await postOnce(cfg, envelope);
  if (!result.ok) {
    logger.warn(
      { eventId: envelope.eventId, eventType: envelope.eventType, status: result.status, err: result.error },
      "hermes webhook delivery failed — retrying once",
    );
    // attempt 2 (single retry)
    result = await postOnce(cfg, envelope);
  }

  if (result.ok) {
    logger.info({ eventId: envelope.eventId, eventType: envelope.eventType }, "hermes webhook delivered");
  } else {
    logger.error(
      { eventId: envelope.eventId, eventType: envelope.eventType, status: result.status, err: result.error },
      "hermes webhook delivery failed after retry — giving up",
    );
  }
}

/**
 * Convenience wrapper for the central emit point (lib/events.ts logEvent).
 * Fire-and-forget; safe to call unconditionally. See ACTIVATION.md for the
 * one-line integration.
 */
export function fireWebhook(event: OutboundEvent): void {
  void sendWebhook(event);
}
