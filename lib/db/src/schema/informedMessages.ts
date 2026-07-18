import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const informedMessagesTable = pgTable(
  "informed_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("informed_messages_user_id_idx").on(table.userId)],
);

export type InformedMessageRow = typeof informedMessagesTable.$inferSelect;
