import {
  pgTable,
  text,
  integer,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const tractatusTiersTable = pgTable(
  "tractatus_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: text("job_id").notNull(),
    jobType: text("job_type").notNull(),
    tier: integer("tier").notNull(),
    tree: jsonb("tree").notNull(),
    nodeCount: integer("node_count").notNull().default(0),
    parentTierId: uuid("parent_tier_id"),
    compressionCount: integer("compression_count").notNull().default(0),
    lastUpdate: timestamp("last_update", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_tractatus_tiers_job").on(t.jobId, t.jobType, t.tier),
  ],
);

export const tractatusArchiveTable = pgTable(
  "tractatus_archive",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: text("job_id").notNull(),
    jobType: text("job_type").notNull(),
    tier: integer("tier").notNull(),
    treeSnapshot: jsonb("tree_snapshot").notNull(),
    nodeCountAtSnapshot: integer("node_count_at_snapshot").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_tractatus_archive_job").on(t.jobId, t.jobType, t.createdAt),
  ],
);

export type TractatusTierRow = typeof tractatusTiersTable.$inferSelect;
export type TractatusArchiveRow = typeof tractatusArchiveTable.$inferSelect;
