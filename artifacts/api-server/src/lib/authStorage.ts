import { db, usersTable, visitsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type UserRow = {
  id: number;
  username: string;
  googleId?: string | null;
  email?: string | null;
  displayName?: string | null;
};

type VisitRow = {
  id: number;
  email: string | null;
  visitedAt: Date;
};

export const storage = {
  async getUserById(id: number): Promise<UserRow | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return user;
  },

  async getUserByGoogleId(googleId: string): Promise<UserRow | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.googleId, googleId))
      .limit(1);
    return user;
  },

  async getUserByEmail(email: string): Promise<UserRow | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return user;
  },

  async createUserWithGoogle({
    username,
    googleId,
    email,
    displayName,
  }: {
    username: string;
    googleId: string;
    email: string | null;
    displayName: string | null;
  }): Promise<UserRow> {
    const [user] = await db
      .insert(usersTable)
      .values({ username, googleId, email, displayName })
      .returning();
    return user;
  },

  async updateUserGoogle(
    id: number,
    patch: { googleId?: string; displayName?: string | null },
  ): Promise<UserRow> {
    const [user] = await db
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, id))
      .returning();
    return user;
  },

  async recordVisit(userId: number, email: string | null): Promise<void> {
    await db.insert(visitsTable).values({ userId, email });
  },

  async getVisits(limit: number): Promise<VisitRow[]> {
    return db
      .select({
        id: visitsTable.id,
        email: visitsTable.email,
        visitedAt: visitsTable.visitedAt,
      })
      .from(visitsTable)
      .orderBy(visitsTable.visitedAt)
      .limit(limit);
  },

  async getVisitTimestampsSince(_since: Date | null): Promise<string[]> {
    const rows = await db
      .select({ visitedAt: visitsTable.visitedAt })
      .from(visitsTable);
    return rows.map((r) => r.visitedAt.toISOString());
  },
};
