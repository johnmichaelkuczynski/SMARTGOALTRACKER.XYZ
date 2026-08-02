import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, accomplishmentsTable } from "@workspace/db";

const router: IRouter = Router();

/** Ensure the table exists (idempotent). */
async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS accomplishments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS accomplishments_user_date
      ON accomplishments (user_id, date DESC);
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

// ── GET /accomplishments ──────────────────────────────────────────────────────
router.get("/accomplishments", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const client = await getDb();
    const rows = await client
      .select()
      .from(accomplishmentsTable)
      .where(eq(accomplishmentsTable.userId, userId))
      .orderBy(desc(accomplishmentsTable.date), desc(accomplishmentsTable.createdAt));
    res.json({ accomplishments: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch accomplishments");
    res.status(500).json({ error: "Failed to fetch accomplishments" });
  }
});

// ── POST /accomplishments ─────────────────────────────────────────────────────
router.post("/accomplishments", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { text, date } = req.body as { text?: string; date?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const dateVal = date ?? today;
  try {
    const client = await getDb();
    const [row] = await client
      .insert(accomplishmentsTable)
      .values({ id: randomUUID(), userId, text: text.trim(), date: dateVal })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create accomplishment");
    res.status(500).json({ error: "Failed to create accomplishment" });
  }
});

// ── PATCH /accomplishments/:id ────────────────────────────────────────────────
router.patch("/accomplishments/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  const { text, date } = req.body as { text?: string; date?: string };
  if (!text?.trim() && !date) {
    res.status(400).json({ error: "text or date required" });
    return;
  }
  try {
    const client = await getDb();
    const updates: Partial<{ text: string; date: string; updatedAt: Date }> = {
      updatedAt: new Date(),
    };
    if (text?.trim()) updates.text = text.trim();
    if (date) updates.date = date;
    const [row] = await client
      .update(accomplishmentsTable)
      .set(updates)
      .where(and(eq(accomplishmentsTable.id, id), eq(accomplishmentsTable.userId, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update accomplishment");
    res.status(500).json({ error: "Failed to update accomplishment" });
  }
});

// ── DELETE /accomplishments/:id ───────────────────────────────────────────────
router.delete("/accomplishments/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const client = await getDb();
    await client
      .delete(accomplishmentsTable)
      .where(and(eq(accomplishmentsTable.id, id), eq(accomplishmentsTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete accomplishment");
    res.status(500).json({ error: "Failed to delete accomplishment" });
  }
});

export default router;
