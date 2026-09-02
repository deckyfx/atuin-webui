import { eq, count, sql } from "drizzle-orm";
import { getServerDb } from "../db";
import { users, sessions, store } from "../db/schema";
import type { User } from "../db/schema";

/**
 * A user as the dashboard exposes it.
 *
 * Built by omission from {@link User} rather than extension: the row carries a
 * password hash, and deriving the public shape from the table means a column
 * added upstream is served by default. Naming the safe fields means it is not.
 */
export interface UserWithStats extends Omit<User, "password"> {
  sessionCount: number;
  storeRecords: number;
}

export class UserStore {
  /** Get all users with their session and store record counts */
  static async findAll(): Promise<UserWithStats[]> {
    const allUsers = await getServerDb()
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        // The password hash is deliberately not selected: this feeds
        // GET /api/users, and serving every user's hash to any caller that can
        // reach the port is a credential disclosure, not a display detail.
        // Cast explicitly to string so Drizzle never coerces to a Date object
        createdAt: sql<string>`CAST(${users.createdAt} AS TEXT)`,
      })
      .from(users)
      .orderBy(users.createdAt);

    const enriched = await Promise.all(
      allUsers.map(async (user) => {
        const [sessionRes, storeRes] = await Promise.all([
          getServerDb().select({ count: count() }).from(sessions).where(eq(sessions.userId, user.id)),
          getServerDb().select({ count: count() }).from(store).where(eq(store.userId, user.id)),
        ]);

        return {
          ...user,
          sessionCount: sessionRes[0]?.count ?? 0,
          storeRecords: storeRes[0]?.count ?? 0,
        };
      })
    );

    return enriched;
  }

  /** Delete a user and all their associated data */
  static async delete(userId: number): Promise<boolean> {
    await getServerDb().delete(sessions).where(eq(sessions.userId, userId));
    await getServerDb().delete(store).where(eq(store.userId, userId));
    const result = await getServerDb().delete(users).where(eq(users.id, userId)).returning();
    return result.length > 0;
  }
}
