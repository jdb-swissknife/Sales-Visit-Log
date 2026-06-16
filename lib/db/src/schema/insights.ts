import { pgTable, text, serial, timestamp, integer, real, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

/**
 * Hermes-written analysis, advisory only — the app never derives behavior
 * from these tables; they are displayed/queried as context.
 * Upsert key: (businessId, type) and (repId, type) respectively.
 */
export const prospectInsightsTable = pgTable(
  "prospect_insights",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    agentRunId: integer("agent_run_id"),
    /** e.g. interest_profile | objection_history | next_best_action */
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    score: real("score"),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("prospect_insights_business_type_uq").on(t.businessId, t.type)],
);

export const repInsightsTable = pgTable(
  "rep_insights",
  {
    id: serial("id").primaryKey(),
    /** Free-form rep identifier until team auth lands (Phase 1 backlog) */
    repId: text("rep_id").notNull(),
    agentRunId: integer("agent_run_id"),
    /** e.g. daily_debrief | coaching_focus | weekly_summary */
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    score: real("score"),
    data: jsonb("data"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("rep_insights_rep_type_uq").on(t.repId, t.type)],
);

export const insertProspectInsightSchema = createInsertSchema(prospectInsightsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertRepInsightSchema = createInsertSchema(repInsightsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ProspectInsight = typeof prospectInsightsTable.$inferSelect;
export type RepInsight = typeof repInsightsTable.$inferSelect;
export type InsertProspectInsight = z.infer<typeof insertProspectInsightSchema>;
export type InsertRepInsight = z.infer<typeof insertRepInsightSchema>;
