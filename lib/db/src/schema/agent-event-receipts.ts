import { pgTable, text, serial, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";

/**
 * Webhook idempotency ledger. Every accepted canonical event is recorded by
 * its envelope eventId; a duplicate eventId is acknowledged with 200 and
 * otherwise ignored.
 */
export const agentEventReceiptsTable = pgTable(
  "agent_event_receipts",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Full envelope as received (for audit/replay) */
    payload: jsonb("payload"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_event_receipts_event_id_uq").on(t.eventId)],
);

export const insertAgentEventReceiptSchema = createInsertSchema(agentEventReceiptsTable).omit({
  id: true,
  receivedAt: true,
});
export type InsertAgentEventReceipt = z.infer<typeof insertAgentEventReceiptSchema>;
export type AgentEventReceipt = typeof agentEventReceiptsTable.$inferSelect;
