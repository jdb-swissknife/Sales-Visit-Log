import { pgTable, text, serial, timestamp, integer, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

/**
 * Suggestions written by Hermes (the AI agent) and shown to reps in the app.
 * Hermes writes via POST /api/agent/suggestions (API-key auth);
 * the app reads via GET /api/suggestions and streams new ones over SSE.
 *
 * Hermes is advisory only — rows here never trigger app-side automation.
 */
export const agentSuggestionsTable = pgTable(
  "agent_suggestions",
  {
    id: serial("id").primaryKey(),
    /** Hermes's own identifier for this suggestion */
    externalId: text("external_id"),
    /** References agent_runs.id when the suggestion came out of a tracked run */
    agentRunId: integer("agent_run_id"),
    /** callback_reminder | nearby_prospect | coaching | debrief | other */
    type: text("type").notNull().default("other"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    businessId: integer("business_id").references(() => businessesTable.id, {
      onDelete: "set null",
    }),
    /** Free-form rep identifier until team auth lands */
    repId: text("rep_id"),
    /** low | normal | high | urgent */
    priority: text("priority").notNull().default("normal"),
    priorityScore: real("priority_score"),
    /** unread | read | acted | dismissed */
    status: text("status").notNull().default("unread"),
    /** Same key ⇒ upsert instead of duplicate feed entries */
    dedupeKey: text("dedupe_key"),
    /** Optional CTA, e.g. "Open prospect" → /businesses/12 */
    actionLabel: text("action_label"),
    actionUrl: text("action_url"),
    /** Free-form context from Hermes (distances, history refs, etc.) */
    data: jsonb("data"),
    /** Who produced it — "hermes" for the agent */
    source: text("source").notNull().default("hermes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_suggestions_status_idx").on(t.status),
    index("agent_suggestions_created_at_idx").on(t.createdAt),
    uniqueIndex("agent_suggestions_dedupe_key_uq").on(t.dedupeKey),
  ],
);

export const insertAgentSuggestionSchema = createInsertSchema(agentSuggestionsTable).omit({
  id: true,
  createdAt: true,
  readAt: true,
  actedAt: true,
  dismissedAt: true,
});
export type InsertAgentSuggestion = z.infer<typeof insertAgentSuggestionSchema>;
export type AgentSuggestion = typeof agentSuggestionsTable.$inferSelect;
