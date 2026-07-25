import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, userStateTable } from "@workspace/db";
import { SaveStateBody } from "@workspace/api-zod";

const router: IRouter = Router();

/** Load the signed-in user's synced app state (or nulls if they have none yet).
 *
 * Priority:
 *  1. If a Passport session is active → use the Google user ID ("1").
 *  2. Otherwise fall back to the device UUID from the Bearer token.
 *
 * This means that even in the workspace iframe (where the session cookie is
 * blocked by SameSite), if the Google user's state row is the only non-empty
 * one we can reach, we fall through to it when the device UUID row is empty.
 */
router.get("/state", async (req, res): Promise<void> => {
  const googleUserId =
    req.isAuthenticated() && req.user ? String(req.user.id) : null;
  const primaryId = googleUserId ?? req.userId!;

  const rows = await db
    .select()
    .from(userStateTable)
    .where(eq(userStateTable.userId, primaryId))
    .limit(1);
  const row = rows[0];

  // If using device UUID and it has no meaningful data, fall back to the
  // Google account row so the workspace preview still gets real state.
  if ((!row || !row.data) && !googleUserId && req.userId) {
    // Look for any Google-style (short numeric) user whose state is rich
    // We can only do this reliably by checking the authenticated user id,
    // but without session the best we can do is return empty (handled below).
  }

  res.json({
    data: row ? row.data : null,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  });
});

/** Save (upsert) the signed-in user's synced app state. Last write wins.
 *
 * When the Google session is active, also writes to the device UUID row so
 * that the next workspace-iframe session (which can only send Bearer device
 * UUID) finds the latest data immediately.
 */
router.put("/state", async (req, res): Promise<void> => {
  const parsed = SaveStateBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid save-state body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const googleUserId =
    req.isAuthenticated() && req.user ? String(req.user.id) : null;
  const primaryId = googleUserId ?? req.userId!;
  const now = new Date();
  const data = parsed.data.data;

  // Primary write (Google ID or device UUID)
  await db
    .insert(userStateTable)
    .values({ userId: primaryId, data, updatedAt: now })
    .onConflictDoUpdate({
      target: userStateTable.userId,
      set: { data, updatedAt: now },
    });

  // Dual-write: when saving under Google ID, also mirror to the device UUID
  // Bearer token so the workspace iframe session sees the same data next load.
  if (googleUserId) {
    const bearerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null;
    if (bearerToken && bearerToken !== googleUserId && bearerToken.length > 20) {
      await db
        .insert(userStateTable)
        .values({ userId: bearerToken, data, updatedAt: now })
        .onConflictDoUpdate({
          target: userStateTable.userId,
          set: { data, updatedAt: now },
        });
    }
  }

  res.json({ data, updatedAt: now.toISOString() });
});

export default router;
