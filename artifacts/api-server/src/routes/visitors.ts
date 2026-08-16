import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { isAdmin } from "../lib/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Simple in-memory per-IP rate limit (proxy-aware; trust proxy is set) ─────
const RATE_LIMIT = 30; // requests
const RATE_WINDOW_MS = 60_000;
const ipHits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Periodically prune stale entries so the map cannot grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, entry] of ipHits) {
    if (entry.windowStart < cutoff) ipHits.delete(ip);
  }
}, 5 * 60_000).unref();

/** Ensure the table exists (idempotent). */
async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS page_visits (
      id SERIAL PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      visited_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS hour_bucket BIGINT NOT NULL
      DEFAULT (floor(extract(epoch FROM now()) / 3600));
    CREATE UNIQUE INDEX IF NOT EXISTS page_visits_visitor_hour
      ON page_visits (visitor_id, hour_bucket);
    CREATE INDEX IF NOT EXISTS page_visits_time ON page_visits (visited_at DESC);
  ` as unknown as Parameters<typeof db.execute>[0]);
}

let tableReady = false;
async function getDb() {
  if (!tableReady) {
    await ensureTable();
    tableReady = true;
  }
  return db;
}

// ── POST /track-visit ─────────────────────────────────────────────────────────
// Public, fire-and-forget. Atomically records at most one visit per visitor
// per hour bucket via a unique index + ON CONFLICT DO NOTHING.
router.post("/track-visit", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  const { visitorId } = req.body as { visitorId?: string };
  if (typeof visitorId !== "string" || !UUID_RE.test(visitorId)) {
    res.status(400).json({ error: "visitorId must be a UUID" });
    return;
  }
  const id = visitorId.toLowerCase();
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  try {
    const client = await getDb();
    await client.execute(sql`
      INSERT INTO page_visits (visitor_id, hour_bucket)
      VALUES (${id}, ${hourBucket})
      ON CONFLICT (visitor_id, hour_bucket) DO NOTHING
    `);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to track visit");
    res.status(500).json({ error: "Failed to track visit" });
  }
});

// ── GET /admin/unique-visitors ────────────────────────────────────────────────
router.get("/admin/unique-visitors", isAdmin, async (req, res): Promise<void> => {
  try {
    const client = await getDb();
    const result = await client.execute(sql`
      SELECT
        count(DISTINCT visitor_id) AS all_time,
        count(DISTINCT visitor_id) FILTER (WHERE visited_at > now() - interval '24 hours') AS last_24_hours,
        count(DISTINCT visitor_id) FILTER (WHERE visited_at > now() - interval '7 days')   AS last_week,
        count(DISTINCT visitor_id) FILTER (WHERE visited_at > now() - interval '30 days')  AS last_month,
        count(DISTINCT visitor_id) FILTER (WHERE visited_at > now() - interval '365 days') AS last_year,
        count(*) AS total_visits
      FROM page_visits
    `);
    const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
    res.json({
      uniqueVisitors: {
        allTime: Number(row.all_time ?? 0),
        last24Hours: Number(row.last_24_hours ?? 0),
        lastWeek: Number(row.last_week ?? 0),
        lastMonth: Number(row.last_month ?? 0),
        lastYear: Number(row.last_year ?? 0),
      },
      totalVisits: Number(row.total_visits ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load unique visitors");
    res.status(500).json({ error: "Failed to load unique visitors" });
  }
});

export default router;
