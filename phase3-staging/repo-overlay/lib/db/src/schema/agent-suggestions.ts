import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";
import { agentRunsTable } from "./agent-runs";

/**
 * Agent suggestions — actionable items surfaced to the rep, produced either by Hermes
 * (via POST /api/agent/suggestions) or deterministically in-app. The feed UI reads this.
 *
 * `externalId` is the Hermes-side ULID (null for in-app suggestions). `dedupeKey` drives
 * upsert so the same suggestion isn't shown twice. `priority` stores low|normal|high|urgent;
 * the agent route normalizes the contract value `medium` -> `normal` on input.
 */
export const agentSuggestionsTable = pgTable(
  "agent_suggestions",
  {
    id: serial("id").primaryKey(),
    /** Hermes-side suggestion id (ULID/text); unique; null for in-app suggestions. */
    externalId: text("external_id").unique(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    agentRunId: integer("agent_run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** low | normal | high | urgent (contract `medium` normalized to `normal` on input) */
    priority: text("priority").notNull().default("normal"),
    /** unread | read | acted | dismissed */
    status: text("status").notNull().default("unread"),
    /** stable de-duplication key; unique so repeated emits upsert rather than duplicate. */
    dedupeKey: text("dedupe_key").unique(),
    readAt: timestamp("read_at", { withTimezone: true }),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_suggestions_business_id_idx").on(t.businessId),
    index("agent_suggestions_status_idx").on(t.status),
    index("agent_suggestions_agent_run_id_idx").on(t.agentRunId),
  ],
);

export const insertAgentSuggestionSchema = createInsertSchema(agentSuggestionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentSuggestion = z.infer<typeof insertAgentSuggestionSchema>;
export type AgentSuggestion = typeof agentSuggestionsTable.$inferSelect;
