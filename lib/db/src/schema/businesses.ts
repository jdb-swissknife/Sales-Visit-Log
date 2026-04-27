import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessesTable = pgTable("businesses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  website: text("website"),
  sector: text("sector").notNull(),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  notes: text("notes"),
  mapsUrl: text("maps_url"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("not_contacted"),
  callType: text("call_type").notNull().default("walk_in"),
  routeDay: integer("route_day"),
  isBonus: boolean("is_bonus").notNull().default(false),
  buildingGroup: text("building_group"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBusinessSchema = createInsertSchema(businessesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businessesTable.$inferSelect;
