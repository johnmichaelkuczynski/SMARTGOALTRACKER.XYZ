import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const informedMessagesTable = pgTable(
  "informed_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    imageData: text("image_data"),
    imageMediaType: text("image_media_type"),
    attachments: text("attachments"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("informed_messages_user_id_idx").on(table.userId),
    index("informed_messages_conv_id_idx").on(table.conversationId),
  ],
);

export type InformedMessageRow = typeof informedMessagesTable.$inferSelect;
