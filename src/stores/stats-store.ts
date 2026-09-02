import { sql, eq, count } from "drizzle-orm";
import { getServerDb } from "../db";
import { users, sessions, history, store } from "../db/schema";
import { envConfig } from "../env-config";

export interface OverviewStats {
  totalUsers: number;
  totalSessions: number;
  totalHistory: number;
  totalStore: number;
  dbSizeBytes: number;
}

export interface HostStat {
  host: string;
  tag: string;
  recordCount: number;
  latestSync: string | null;
}

export interface ActivityDay {
  date: string;
  count: number;
}

function toHex(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("hex");
  }
  if (value !== null && typeof value === "object") {
    // Drizzle may return binary columns as plain objects with numeric keys
    const bytes = Object.values(value as Record<string, number>);
    return Buffer.from(bytes).toString("hex");
  }
  return String(value);
}

export class StatsStore {
  /** Get high-level overview statistics */
  static async getOverview(): Promise<OverviewStats> {
    const [usersRes, sessionsRes, historyRes, storeRes] = await Promise.all([
      getServerDb().select({ count: count() }).from(users),
      getServerDb().select({ count: count() }).from(sessions),
      getServerDb().select({ count: count() }).from(history),
      getServerDb().select({ count: count() }).from(store),
    ]);

    const dbFile = Bun.file(envConfig.SERVER_DB_PATH);
    const dbSizeBytes = dbFile.size;

    return {
      totalUsers: usersRes[0]?.count ?? 0,
      totalSessions: sessionsRes[0]?.count ?? 0,
      totalHistory: historyRes[0]?.count ?? 0,
      totalStore: storeRes[0]?.count ?? 0,
      dbSizeBytes,
    };
  }

  /** Get per-host, per-tag record counts */
  static async getHostStats(): Promise<HostStat[]> {
    const rows = await getServerDb()
      .select({
        host: store.host,
        tag: store.tag,
        recordCount: count(),
        latestSync: sql<string>`CAST(MAX(${store.createdAt}) AS TEXT)`,
      })
      .from(store)
      .groupBy(store.host, store.tag)
      .orderBy(sql`COUNT(*) DESC`);

    return rows.map((r) => ({
      // host column contains binary UUID data — encode as hex for display
      host: toHex(r.host),
      tag: r.tag,
      recordCount: r.recordCount,
      latestSync: r.latestSync,
    }));
  }

  /** Get sync activity grouped by day (last 30 days) */
  static async getActivity(): Promise<ActivityDay[]> {
    const rows = await getServerDb()
      .select({
        date: sql<string>`CAST(date(${store.createdAt}) AS TEXT)`,
        count: count(),
      })
      .from(store)
      .groupBy(sql`date(${store.createdAt})`)
      .orderBy(sql`date(${store.createdAt}) DESC`)
      .limit(30);

    return rows.map((r) => ({
      date: r.date,
      count: r.count,
    }));
  }
}
