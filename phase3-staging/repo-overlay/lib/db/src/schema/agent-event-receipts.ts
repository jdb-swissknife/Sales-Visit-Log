import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

/**
 * Agent event receipts — idempotency ledger for inbound signed webhooks from Hermes.
 * `eventId` (the envelope ULID) is the unique idempotency key: a duplicate delivery is
 * detected here and short-circuits with {duplicate:true} instead of queuing another run.
 */
export const agentEventReceiptsTable = pgTable(
  "agent_event_receipts",
  {
    id: serial("id").primaryKey(),
    /** Envelope event id (ULID/text) — unique idempotency key. */
    eventId: text("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    source: text("source"),
    correlationId: text("correlation_id"),
    repId: integer("rep_id"),
    businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
    payload: jsonb("payload"),
    /** received | processed | ignored | failed */
    processingStatus: text("processing_status").notNull().default("received"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_event_receipts_business_id_idx").on(t.businessId),
    index("agent_event_receipts_processing_status_idx").on(t.processingStatus),
  ],
);

export const insertAgentEventReceiptSchema = createInsertSchema(agentEventReceiptsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentEventReceipt = z.infer<typeof insertAgentEventReceiptSchema>;
export type AgentEventReceipt = typeof agentEventReceiptsTable.$inferSelect;
