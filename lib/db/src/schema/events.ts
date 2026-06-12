import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Activity log — every meaningful app action is recorded here.
 * This is the feed Hermes (the AI agent) reads to build context.
 */
export const eventsTable = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    /** e.g. visit.created, note.created, media.transcribed, visit.synced_offline */
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    businessId: integer("business_id"),
    visitId: integer("visit_id"),
    /** Free-form context for the event (outcome, counts, etc.) */
    payload: jsonb("payload"),
    /** "server" for API-side logging, "client" for app-emitted events */
    source: text("source").notNull().default("server"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_created_at_idx").on(t.createdAt),
    index("events_type_idx").on(t.type),
    index("events_business_id_idx").on(t.businessId),
  ],
);

export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;
