import { pgTable, text, serial, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Team-specific coaching profiles. One row per scope (global, rep, team).
 * Resolution order: rep scope first, then global fallback. See
 * api-server/src/lib/coaching-context.ts.
 */
export const coachingProfilesTable = pgTable(
  "coaching_profiles",
  {
    id: serial("id").primaryKey(),
    /** global | rep | team (only global and rep are used in resolution today) */
    scopeType: text("scope_type").notNull().default("global"),
    /** "default" for global, "rep-7" for a rep-specific profile */
    scopeKey: text("scope_key").notNull(),
    name: text("name").notNull(),
    transcriptInstructions: text("transcript_instructions"),
    coachingInstructions: text("coaching_instructions"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("coaching_profiles_scope_uq").on(t.scopeType, t.scopeKey),
    index("coaching_profiles_lookup_idx").on(t.enabled, t.scopeType, t.scopeKey),
  ],
);

export const insertCoachingProfileSchema = createInsertSchema(coachingProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCoachingProfile = z.infer<typeof insertCoachingProfileSchema>;
export type CoachingProfile = typeof coachingProfilesTable.$inferSelect;
