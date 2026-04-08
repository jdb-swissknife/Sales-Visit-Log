import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { visitsTable } from "./visits";

export const mediaTable = pgTable("media", {
  id: serial("id").primaryKey(),
  visitId: integer("visit_id").notNull().references(() => visitsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  caption: text("caption"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMediaSchema = createInsertSchema(mediaTable).omit({ id: true, createdAt: true });
export type InsertMedia = z.infer<typeof insertMediaSchema>;
export type Media = typeof mediaTable.$inferSelect;
