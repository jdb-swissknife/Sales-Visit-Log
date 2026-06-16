import { db, eventsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendWebhook, shouldWebhook } from "./webhooks";

export interface LogEventInput {
  type: string;
  entityType?: string;
  entityId?: number;
  businessId?: number | null;
  visitId?: number | null;
  payload?: Record<string, unknown>;
  source?: "server" | "client";
}

/**
 * Append an event to the activity log. Never throws — activity logging
 * must not break the primary request path.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await db.insert(eventsTable).values({
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      businessId: input.businessId ?? null,
      visitId: input.visitId ?? null,
      payload: input.payload ?? null,
      source: input.source ?? "server",
    });

    // Push key events to Hermes in near-real-time (no-op unless configured)
    if (shouldWebhook(input.type)) {
      sendWebhook(input.type, {
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        businessId: input.businessId ?? null,
        visitId: input.visitId ?? null,
        payload: input.payload ?? null,
      });
    }
  } catch (err) {
    logger.error({ err, eventType: input.type }, "Failed to log event");
  }
}
