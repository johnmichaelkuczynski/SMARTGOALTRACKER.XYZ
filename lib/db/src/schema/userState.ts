import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const userStateTable = pgTable("user_state", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserState = typeof userStateTable.$inferSelect;
