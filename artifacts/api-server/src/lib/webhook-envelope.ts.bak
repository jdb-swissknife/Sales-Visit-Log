import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";

/**
 * Canonical webhook contract between the app and Hermes.
 * Shared by the outbound sender (lib/webhooks.ts) and the inbound
 * receiver (routes/webhooks-inbound.ts) so the two can never drift.
 */

export const WEBHOOK_VERSION = "1";

export const CANONICAL_EVENT_TYPES = [
  "visit.created",
  "visit.updated",
  "media.transcribed",
  "callback.due",
  "day.ended",
  "visit.synced_offline",
] as const;
export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

export const WebhookEnvelope = z.object({
  version: z.string(),
  eventId: z.string().min(1),
  eventType: z.enum(CANONICAL_EVENT_TYPES),
  occurredAt: z.string(),
  source: z.string(),
  environment: z.string(),
  correlationId: z.string().nullish(),
  rep: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  business: z
    .object({
      id: z.number().nullish(),
      name: z.string().nullish(),
      address: z.string().nullish(),
      status: z.string().nullish(),
    })
    .nullish(),
  visit: z
    .object({
      id: z.number().nullish(),
      outcome: z.string().nullish(),
      visitedAt: z.string().nullish(),
    })
    .nullish(),
  callback: z
    .object({ visitId: z.number().nullish(), dueAt: z.string().nullish() })
    .nullish(),
  media: z
    .object({
      id: z.number().nullish(),
      type: z.string().nullish(),
      transcript: z.string().nullish(),
    })
    .nullish(),
  daySummary: z.record(z.string(), z.unknown()).nullish(),
  appContext: z.record(z.string(), z.unknown()).nullish(),
  links: z.record(z.string(), z.string()).nullish(),
});
export type WebhookEnvelopeType = z.infer<typeof WebhookEnvelope>;

export const SIGNATURE_HEADER = "x-outreach-signature";
export const EVENT_HEADER = "x-outreach-event";
export const EVENT_ID_HEADER = "x-outreach-event-id";
export const TIMESTAMP_HEADER = "x-outreach-timestamp";
export const VERSION_HEADER = "x-outreach-version";

/** sha256=<hex> HMAC of the raw request body. */
export function signBody(rawBody: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const provided = Buffer.from(signatureHeader);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
