import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const tipsTable = pgTable("tips", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  /** Short title, e.g. "Getting a website indexed by Google" */
  title: text("title").notNull(),
  /** The tip body — instructions, notes, steps */
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tip = typeof tipsTable.$inferSelect;
export type NewTip = typeof tipsTable.$inferInsert;
