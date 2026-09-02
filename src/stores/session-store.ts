import { eq } from "drizzle-orm";
import { getServerDb } from "../db";
import { sessions, users } from "../db/schema";

export interface SessionWithUser {
  id: number;
  userId: number | null;
  token: string;
  username: string | null;
  email: string | null;
}

export class SessionStore {
  /** Get all sessions with their associated user info */
  static async findAll(): Promise<SessionWithUser[]> {
    const rows = await getServerDb()
      .select({
        id: sessions.id,
        userId: sessions.userId,
        token: sessions.token,
        username: users.username,
        email: users.email,
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
