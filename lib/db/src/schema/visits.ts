import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

export const visitsTable = pgTable("visits", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businessesTable.id, { onDelete: "cascade" }),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  outcome: text("outcome").notNull().default("neutral"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  nextActionDate: timestamp("next_action_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVisitSchema = createInsertSchema(visitsTable).omit({ id: true, createdAt: true });
export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Visit = typeof visitsTable.$inferSelect;
