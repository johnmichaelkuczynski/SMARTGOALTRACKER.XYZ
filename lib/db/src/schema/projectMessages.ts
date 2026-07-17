import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const projectMessagesTable = pgTable(
  "project_messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("project_messages_project_id_idx").on(table.projectId),
    index("project_messages_user_id_idx").on(table.userId),
  ],
);

export type ProjectMessageRow = typeof projectMessagesTable.$inferSelect;
