import { eq, count, sql } from "drizzle-orm";
import { getServerDb } from "../db";
import { users, sessions, store } from "../db/schema";
import type { User } from "../db/schema";

/**
 * A user as the dashboard exposes it.
 *
 * {@link User} already excludes the password hash, so extending it cannot
 * reintroduce the hash by accident.
 */
export interface UserWithStats extends User {
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

    // Two grouped queries rather than 2N+1: the previous shape issued a pair
    // of counts per user, and `store` holds a row per synced record, so the
    // cost grew with both the user count and the size of the store.
    const [sessionCounts, storeCounts] = await Promise.all([
      getServerDb()
        .select({ userId: sessions.userId, count: count() })
        .from(sessions)
        .groupBy(sessions.userId),
      getServerDb()
        .select({ userId: store.userId, count: count() })
        .from(store)
        .groupBy(store.userId),
    ]);

    const sessionByUser = new Map(sessionCounts.map((r) => [r.userId, r.count]));
    const storeByUser = new Map(storeCounts.map((r) => [r.userId, r.count]));

    return allUsers.map((user) => ({
      ...user,
      sessionCount: sessionByUser.get(user.id) ?? 0,
      storeRecords: storeByUser.get(user.id) ?? 0,
    }));
  }

  /**
   * What {@link delete} would remove for a user.
   *
   * The cascade is not visible from the row: deleting an account also drops
   * its sessions and every synced record, which can be tens of thousands.
   */
  static async deletePreview(
    userId: number
  ): Promise<{ sessions: number; records: number } | null> {
    const [user] = await getServerDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return null;

    const [sessionRes, storeRes] = await Promise.all([
      getServerDb().select({ count: count() }).from(sessions).where(eq(sessions.userId, userId)),
      getServerDb().select({ count: count() }).from(store).where(eq(store.userId, userId)),
    ]);
    return { sessions: sessionRes[0]?.count ?? 0, records: storeRes[0]?.count ?? 0 };
  }

  /**
   * Deletes a user and everything belonging to them.
   *
   * Wrapped in a transaction: as three independent statements, a failure
   * partway through left the account with its sessions or records already
   * gone — or worse, left orphaned sessions pointing at a deleted user.
   */
  static async delete(userId: number): Promise<boolean> {
    return getServerDb().transaction((tx) => {
      tx.delete(sessions).where(eq(sessions.userId, userId)).run();
      tx.delete(store).where(eq(store.userId, userId)).run();
      const result = tx.delete(users).where(eq(users.id, userId)).returning().all();
      return result.length > 0;
    });
  }
}
