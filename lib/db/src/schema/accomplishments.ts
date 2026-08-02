import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const accomplishmentsTable = pgTable("accomplishments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  /** ISO date string YYYY-MM-DD — the day the accomplishment occurred */
  date: text("date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Accomplishment = typeof accomplishmentsTable.$inferSelect;
export type NewAccomplishment = typeof accomplishmentsTable.$inferInsert;
