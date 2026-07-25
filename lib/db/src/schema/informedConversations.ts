import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const informedConversationsTable = pgTable(
  "informed_conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New chat"),
    parentId: text("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("informed_conversations_user_id_idx").on(table.userId)],
);

export type InformedConversationRow = typeof informedConversationsTable.$inferSelect;
