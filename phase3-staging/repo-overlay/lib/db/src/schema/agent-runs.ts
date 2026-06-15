import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

/**
 * Agent runs — one row per Hermes reasoning pass (webhook-triggered, cron, or manual).
 * The app queues a `queued` row when a signed inbound webhook arrives; Hermes PATCHes
 * it to running/completed/failed and writes summaries back. No LLM calls happen here —
 * this table is just the run ledger.
 *
 * `eventId` is the external envelope event id (ULID/text), correlating to
 * `agent_event_receipts.eventId`. Entity ids (repId/businessId) are integers (app DB
 * is authoritative). There is no `reps` table in Phase 2, so `repId` has no FK.
 */
export const agentRunsTable = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    /** External envelope event id (ULID/text) that triggered this run; null for manual/cron. */
    eventId: text("event_id"),
    eventType: text("event_type"),
    /** Hermes-side run id (ULID/text). */
    externalRunId: text("external_run_id"),
    /** webhook | cron | manual */
    runType: text("run_type").notNull().default("webhook"),
    repId: integer("rep_id"),
    businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "set null" }),
    /** queued | running | completed | skipped | failed */
    status: text("status").notNull().default("queued"),
    reason: text("reason"),
    inputSummary: text("input_summary"),
    outputSummary: text("output_summary"),
    contextSnapshot: jsonb("context_snapshot"),
    correlationId: text("correlation_id"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_status_idx").on(t.status),
    index("agent_runs_business_id_idx").on(t.businessId),
    index("agent_runs_event_id_idx").on(t.eventId),
    index("agent_runs_external_run_id_idx").on(t.externalRunId),
  ],
);

export const insertAgentRunSchema = createInsertSchema(agentRunsTable).omit({ id: true, createdAt: true });
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRunsTable.$inferSelect;
