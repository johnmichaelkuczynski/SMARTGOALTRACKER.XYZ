import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const legalConversationsTable = pgTable(
  "legal_conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New chat"),
    parentId: text("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("legal_conversations_user_id_idx").on(table.userId)],
);

export type LegalConversationRow = typeof legalConversationsTable.$inferSelect;
