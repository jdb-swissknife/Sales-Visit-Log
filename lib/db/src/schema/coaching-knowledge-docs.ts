import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coachingProfilesTable } from "./coaching-profiles";

/**
 * Knowledge documents attached to a coaching profile. sortOrder gives
 * deterministic prompt order without retrieval complexity. methodTag lets
 * later suggestions expose which method influenced the advice.
 */
export const coachingKnowledgeDocsTable = pgTable(
  "coaching_knowledge_docs",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => coachingProfilesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** leader_playbook, objection_library, buyer_type, offer_context, etc. */
    sourceType: text("source_type").notNull(),
    /** erica, straight_line, hvac_atlanta, etc. */
    methodTag: text("method_tag"),
    body: text("body").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("coaching_knowledge_docs_lookup_idx").on(t.profileId, t.enabled, t.sortOrder)],
);

export const insertCoachingKnowledgeDocSchema = createInsertSchema(coachingKnowledgeDocsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCoachingKnowledgeDoc = z.infer<typeof insertCoachingKnowledgeDocSchema>;
export type CoachingKnowledgeDoc = typeof coachingKnowledgeDocsTable.$inferSelect;
