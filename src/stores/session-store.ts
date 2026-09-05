import { eq, sql } from "drizzle-orm";
import { getServerDb } from "../db";
import { sessions, users } from "../db/schema";

export interface SessionWithUser {
  id: number;
  userId: number | null;
  /**
   * First and last few characters only.
   *
   * `sessions.token` is a live bearer credential for the sync server: anyone
   * holding one is that user. A fingerprint is enough to tell two sessions
   * apart in the UI, which is all this view needs.
   */
  tokenFingerprint: string;
  username: string | null;
}

export class SessionStore {
  /** Get all sessions with their associated user info */
  static async findAll(): Promise<SessionWithUser[]> {
    const rows = await getServerDb()
      .select({
        id: sessions.id,
        userId: sessions.userId,
        // Redacted in SQL rather than after the fact, so the full token is
        // never materialised into a response object at all.
        tokenFingerprint: sql<string>`substr(${sessions.token}, 1, 6) || '…' || substr(${sessions.token}, -4)`,
        // Email is deliberately absent: the username identifies the session
        // for this view, and an unauthenticated endpoint should return the
        // least that answers the question.
        username: users.username,
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.userId, users.id))
      .orderBy(sessions.id);

    return rows;
  }

  /** Revoke (delete) a session by ID */
  static async revoke(sessionId: number): Promise<boolean> {
    const result = await getServerDb().delete(sessions).where(eq(sessions.id, sessionId)).returning();
    return result.length > 0;
  }
}
