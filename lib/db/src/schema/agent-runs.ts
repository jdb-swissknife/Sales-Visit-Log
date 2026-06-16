import { pgTable, text, serial, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per agent processing run, created when a valid canonical event
 * arrives at POST /webhooks/sales-outreach-events. Hermes updates status as
 * it works; suggestions/insights it writes reference agentRunId.
 */
export const agentRunsTable = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    /** Canonical envelope eventId that triggered this run */
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Hermes's own run identifier, if it reports one */
    externalRunId: text("external_run_id"),
    /** queued | running | completed | failed | skipped */
    status: text("status").notNull().default("queued"),
    correlationId: text("correlation_id"),
    error: text("error"),
    /** Run summary/output from Hermes */
    output: jsonb("output"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_event_id_idx").on(t.eventId),
    index("agent_runs_status_idx").on(t.status),
  ],
);

export const insertAgentRunSchema = createInsertSchema(agentRunsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRunsTable.$inferSelect;
