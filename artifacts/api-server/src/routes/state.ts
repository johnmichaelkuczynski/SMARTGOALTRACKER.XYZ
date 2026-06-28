import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userStateTable } from "@workspace/db";
import { SaveStateBody } from "@workspace/api-zod";

const router: IRouter = Router();

/** Load the signed-in user's synced app state (or nulls if they have none yet). */
router.get("/state", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(userStateTable)
    .where(eq(userStateTable.userId, userId))
    .limit(1);
  const row = rows[0];
  res.json({
    data: row ? row.data : null,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  });
});

/** Save (upsert) the signed-in user's synced app state. Last write wins. */
router.put("/state", async (req, res): Promise<void> => {
  const parsed = SaveStateBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid save-state body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const now = new Date();
  const data = parsed.data.data;

  await db
    .insert(userStateTable)
    .values({ userId, data, updatedAt: now })
    .onConflictDoUpdate({
      target: userStateTable.userId,
      set: { data, updatedAt: now },
    });

  res.json({ data, updatedAt: now.toISOString() });
});

export default router;
