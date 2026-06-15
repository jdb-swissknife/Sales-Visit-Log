/**
 * Canonical Hermes webhook envelope (R2).
 *
 * One schema for BOTH directions:
 *   - Outbound: the app stamps `version = WEBHOOK_VERSION` and fires this to Hermes.
 *   - Inbound:  the receiver parses incoming envelopes. Per decision 6 the inbound
 *     path stays permissive on `version` (accepts any string); only entity ID types
 *     are enforced strictly.
 *
 * Locked decisions baked in (REBUILD_PLAN.md):
 *   1. App DB is authoritative → every entity ID is an INTEGER. Strings are rejected
 *      with a clear message so the inbound route can return a clean 400.
 *   5. Thin envelope overall, but carry `media.aiStructured` on `media.transcribed`
 *      and `daySummary` counts on `day.ended`.
 *   6. WEBHOOK_VERSION = "2026-06-12" (matches the contract example).
 */
// `zod/v4` matches the monorepo convention established by the R1 db schema files.
import { z } from "zod/v4";

/** Outbound envelopes stamp this; inbound accepts any version string. */
export const WEBHOOK_VERSION = "2026-06-12";

/**
 * Integer entity ID (businessId, repId, visitId, mediaId, ...).
 * App DB is authoritative — ULIDs never appear here; they live only in text
 * fields like `eventId` / `externalId`. The explicit messages give the inbound
 * receiver clean 400 copy when Hermes mistakenly sends a string/float.
 */
// Plain `.int(message)` form is valid in both zod v3 and v4. A string/float input
// produces zod's default type error, which parseEnvelope() prefixes with the field
// path (e.g. "businessId: Expected number, received string") — a clean 400 body.
const entityId = z
  .number()
  .int("entity IDs must be integers (app DB is authoritative); received a non-integer");

/** ULID / opaque text identifier (never coerced to a number). */
const ulidText = z.string().min(1, "must be a non-empty ULID/text id");

/**
 * Structured AI output attached to `media.transcribed` events (decision 5).
 * Passthrough so Hermes can evolve the shape without an app-side schema bump.
 */
export const MediaAiStructured = z
  .object({
    summary: z.string().optional(),
    sentiment: z.string().optional(),
    language: z.string().optional(),
    topics: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
    actionItems: z.array(z.string()).optional(),
  })
  .passthrough();
export type MediaAiStructured = z.infer<typeof MediaAiStructured>;

/** Roll-up counts attached to `day.ended` events (decision 5). */
export const DaySummary = z
  .object({
    visits: z.number().int().nonnegative().optional(),
    notes: z.number().int().nonnegative().optional(),
    media: z.number().int().nonnegative().optional(),
    businesses: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type DaySummary = z.infer<typeof DaySummary>;

/**
 * Event-specific payload. Kept thin + passthrough so new event types don't
 * require an envelope migration. The two optional typed members are the only
 * fields the contract pins down (decision 5).
 */
export const EnvelopeData = z
  .object({
    /** present on `media.transcribed` */
    aiStructured: MediaAiStructured.optional(),
    /** present on `day.ended` */
    daySummary: DaySummary.optional(),
  })
  .passthrough();
export type EnvelopeData = z.infer<typeof EnvelopeData>;

/**
 * The canonical envelope. Entity IDs are integers; `eventId` is ULID/text.
 * `repId` / `businessId` are nullable+optional because not every event is
 * scoped to a rep or a business (e.g. system-level events).
 */
export const WebhookEnvelope = z.object({
  /** Outbound = WEBHOOK_VERSION; inbound is permissive (any string). */
  version: z.string().min(1),
  /** ULID/opaque text — the idempotency key Hermes and the receiver dedupe on. */
  eventId: ulidText,
  /** e.g. "visit.created", "media.transcribed", "day.ended". */
  eventType: z.string().min(1),
  /** ISO-8601 timestamp the event occurred. */
  occurredAt: z.string().min(1),
  /** Emitter — "app" outbound; inbound may carry "hermes" etc. */
  source: z.string().min(1).default("app"),
  /** Integer rep id, or null when not rep-scoped. */
  repId: entityId.nullable().optional(),
  /** Integer business id, or null when not business-scoped. */
  businessId: entityId.nullable().optional(),
  /** Ties an inbound run back to the outbound event that triggered it. */
  correlationId: z.string().min(1).nullable().optional(),
  /** Event-specific payload (thin, passthrough). */
  data: EnvelopeData.default({}),
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

/**
 * Parse an inbound envelope, returning a flat result the route can turn into a
 * clean 400. Keeps zod's structured issues but exposes a single human message
 * (first issue) for the response body.
 */
export function parseEnvelope(
  input: unknown,
):
  | { ok: true; envelope: WebhookEnvelope }
  | { ok: false; message: string; issues: z.ZodIssue[] } {
  const result = WebhookEnvelope.safeParse(input);
  if (result.success) return { ok: true, envelope: result.data };
  const first = result.error.issues[0];
  const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
  return {
    ok: false,
    message: `invalid webhook envelope — ${path}${first?.message ?? "unparseable"}`,
    issues: result.error.issues,
  };
}
