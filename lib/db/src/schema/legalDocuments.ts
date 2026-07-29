import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const legalDocumentsTable = pgTable(
  "legal_documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    objectPath: text("object_path").notNull(),
    extractedText: text("extracted_text").notNull().default(""),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("legal_documents_user_id_idx").on(table.userId),
    index("legal_documents_conv_id_idx").on(table.conversationId),
  ],
);

export type LegalDocumentRow = typeof legalDocumentsTable.$inferSelect;
