import { pgTable, text, bigint, timestamp, index } from "drizzle-orm/pg-core";

export const projectDocumentsTable = pgTable(
  "project_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull().default("text/plain"),
    content: text("content").notNull().default(""),
    extractedText: text("extracted_text").notNull().default(""),
    objectPath: text("object_path").notNull().default(""),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("project_documents_project_id_idx").on(table.projectId)],
);

export type ProjectDocumentRow = typeof projectDocumentsTable.$inferSelect;
