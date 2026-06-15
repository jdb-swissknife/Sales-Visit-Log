import { pgTable, text, serial, timestamp, integer, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";
import { visitsTable } from "./visits";
import { mediaTable } from "./media";
import { agentRunsTable } from "./agent-runs";

/**
 * Insights — durable prospect-level and rep-level learnings written by Hermes
 * (POST /api/agent/prospect-insights and /rep-insights) and read by the app.
 *
 * Schema expanded per REBUILD_PLAN decision 4 (additive, so the Chunk-4 agent writes
 * without a 2nd migration). The original upsert dimension is kept: (businessId, type) for
 * prospect insights and (repId, type) for rep insights. Field naming keeps `summary` and
 * `score` (rather than body/confidence) to match the agent contract. There is no `reps`
 * table in Phase 2, so `repId` has no FK.
 */
export const insightsTable = pgTable(
  "insights",
  {
    id: serial("id").primaryKey(),
    /** Set for prospect insights; null for rep-level insights. */
    businessId: integer("business_id").references(() => businessesTable.id, { onDelete: "cascade" }),
    /** Set for rep insights; null for prospect-level insights. */
    repId: integer("rep_id"),
    /** Insight category — the upsert dimension paired with businessId/repId. */
    type: text("type").notNull(),
    title: text("title"),
    summary: text("summary"),
    /** Confidence 0..1. */
    score: real("score"),
    /** active | superseded | dismissed */
    status: text("status").notNull().default("active"),
    /** Stable de-duplication key across runs. */
    dedupeKey: text("dedupe_key").unique(),
    sourceRunId: integer("source_run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
    sourceEventId: text("source_event_id"),
    sourceVisitId: integer("source_visit_id").references(() => visitsTable.id, { onDelete: "set null" }),
    sourceMediaId: integer("source_media_id").references(() => mediaTable.id, { onDelete: "set null" }),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Original upsert keys preserved (Postgres treats NULLs as distinct, so the unused
    // dimension's NULL rows don't collide).
    uniqueIndex("insights_business_type_key").on(t.businessId, t.type),
    uniqueIndex("insights_rep_type_key").on(t.repId, t.type),
    index("insights_status_idx").on(t.status),
    index("insights_business_id_idx").on(t.businessId),
    index("insights_rep_id_idx").on(t.repId),
  ],
);

export const insertInsightSchema = createInsertSchema(insightsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInsight = z.infer<typeof insertInsightSchema>;
export type Insight = typeof insightsTable.$inferSelect;
