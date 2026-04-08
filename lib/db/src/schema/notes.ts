import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitsTable } from "./visits";

export const notesTable = pgTable("notes", {
  id: serial("id").primaryKey(),
  visitId: integer("visit_id").notNull().references(() => visitsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("text"),
  content: text("content"),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNoteSchema = createInsertSchema(notesTable).omit({ id: true, createdAt: true });
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notesTable.$inferSelect;
