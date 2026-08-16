import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, tipsTable } from "@workspace/db";

const router: IRouter = Router();

const MAX_TITLE = 500;
const MAX_BODY = 100_000;

/** Ensure the table exists (idempotent). */
async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tips (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tips_user_updated
      ON tips (user_id, updated_at DESC);
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

// ── GET /tips ─────────────────────────────────────────────────────────────────
router.get("/tips", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const client = await getDb();
    const rows = await client
      .select()
      .from(tipsTable)
      .where(eq(tipsTable.userId, userId))
      .orderBy(desc(tipsTable.updatedAt));
    res.json({ tips: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch tips");
    res.status(500).json({ error: "Failed to fetch tips" });
  }
});

// ── POST /tips ────────────────────────────────────────────────────────────────
router.post("/tips", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { title, body } = req.body as { title?: string; body?: string };
  if (!title?.trim() || !body?.trim()) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  if (title.trim().length > MAX_TITLE || body.trim().length > MAX_BODY) {
    res.status(400).json({ error: `title max ${MAX_TITLE} chars, body max ${MAX_BODY} chars` });
    return;
  }
  try {
    const client = await getDb();
    const [row] = await client
      .insert(tipsTable)
      .values({ id: randomUUID(), userId, title: title.trim(), body: body.trim() })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create tip");
    res.status(500).json({ error: "Failed to create tip" });
  }
});

// ── PATCH /tips/:id ───────────────────────────────────────────────────────────
router.patch("/tips/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  const { title, body } = req.body as { title?: string; body?: string };
  if (!title?.trim() && !body?.trim()) {
    res.status(400).json({ error: "title or body required" });
    return;
  }
  if ((title && title.trim().length > MAX_TITLE) || (body && body.trim().length > MAX_BODY)) {
    res.status(400).json({ error: `title max ${MAX_TITLE} chars, body max ${MAX_BODY} chars` });
    return;
  }
  try {
    const client = await getDb();
    const updates: Partial<{ title: string; body: string; updatedAt: Date }> = {
      updatedAt: new Date(),
    };
    if (title?.trim()) updates.title = title.trim();
    if (body?.trim()) updates.body = body.trim();
    const [row] = await client
      .update(tipsTable)
      .set(updates)
      .where(and(eq(tipsTable.id, id), eq(tipsTable.userId, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update tip");
    res.status(500).json({ error: "Failed to update tip" });
  }
});

// ── DELETE /tips/:id ──────────────────────────────────────────────────────────
router.delete("/tips/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const client = await getDb();
    await client
      .delete(tipsTable)
      .where(and(eq(tipsTable.id, id), eq(tipsTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete tip");
    res.status(500).json({ error: "Failed to delete tip" });
  }
});

export default router;
