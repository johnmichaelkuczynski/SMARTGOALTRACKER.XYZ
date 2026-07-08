import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const visitsTable = pgTable("visits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  email: text("email"),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Visit = typeof visitsTable.$inferSelect;
