import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
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
  (table) => [index("documents_user_id_idx").on(table.userId)],
);

export const insertDocumentSchema = createInsertSchema(documentsTable);
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type DocumentRow = typeof documentsTable.$inferSelect;
