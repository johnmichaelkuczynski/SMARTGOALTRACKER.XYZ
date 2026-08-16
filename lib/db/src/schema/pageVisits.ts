import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Anonymous page visits — one row per app load, keyed by a persistent visitor id. */
export const pageVisitsTable = pgTable("page_visits", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id").notNull(),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PageVisit = typeof pageVisitsTable.$inferSelect;
