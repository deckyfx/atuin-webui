import { and, desc, eq, isNull, like, sql, count } from "drizzle-orm";
import { getHistoryDb, readClientMeta } from "../db/history";
import { clientHistory } from "../db/history-schema";
import type { ClientHistoryRow } from "../db/history-schema";
import { envConfig } from "../env-config";

export interface HistoryQuery {
  search?: string;
  hostname?: string;
  exit?: number;
  limit?: number;
  offset?: number;
}

export interface HistoryPage {
  rows: ClientHistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface VerbCount {
  verb: string;
  count: number;
}

export interface ClientOverview {
  profile: string;
  loggedIn: boolean;
  hostId?: string;
  historyDbPath: string;
  totalCommands: number;
  totalHosts: number;
  totalSessions: number;
}

/** Reads over the atuin client's plaintext history. Read-only by design. */
export class HistoryStore {
  /** Only live rows: replayed deletions leave `deleted_at` set. */
  private static liveOnly() {
    return isNull(clientHistory.deletedAt);
  }

  /**
   * Collapses an atuin hostname to the physical machine.
   *
   * atuin records `hostname:username`, and the same machine can appear under
   * more than one string -- a Mac reports both `foo` and `foo.local` depending
   * on how the hostname resolved when the command ran. Counting the raw column
   * therefore overstates the machine count. The dashboard itself never adds a
   * host: it runs under the client's existing host_id.
   */
  private static machineExpr = sql<string>`replace(
    case when instr(${clientHistory.hostname}, ':') > 0
         then substr(${clientHistory.hostname}, 1, instr(${clientHistory.hostname}, ':') - 1)
         else ${clientHistory.hostname} end,
    '.local', ''
  )`;

  /** Paginated, filtered history listing, newest first. */
  static async search(query: HistoryQuery): Promise<HistoryPage> {
    // Clamped at both ends: a negative limit or offset reaches SQLite as a
    // negative LIMIT/OFFSET, which silently changes the query's meaning.
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 500);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

    const filters = [this.liveOnly()];
    if (query.search) filters.push(like(clientHistory.command, `%${query.search}%`));
    if (query.hostname) filters.push(eq(clientHistory.hostname, query.hostname));
    if (query.exit !== undefined) filters.push(eq(clientHistory.exit, query.exit));

    const where = and(...filters);

    const [rows, totalRes] = await Promise.all([
      getHistoryDb()
        .select()
        .from(clientHistory)
        .where(where)
        .orderBy(desc(clientHistory.timestamp))
        .limit(limit)
        .offset(offset),
      getHistoryDb().select({ count: count() }).from(clientHistory).where(where),
    ]);

    return { rows, total: totalRes[0]?.count ?? 0, limit, offset };
  }

  /** High-level counts plus which client profile is being driven. */
  static async overview(): Promise<ClientOverview> {
    const meta = readClientMeta();
    const [res] = await getHistoryDb()
      .select({
        commands: count(),
        hosts: sql<number>`count(distinct ${HistoryStore.machineExpr})`,
        sessions: sql<number>`count(distinct ${clientHistory.session})`,
      })
      .from(clientHistory)
      .where(this.liveOnly());

    return {
      profile: envConfig.PROFILE,
      loggedIn: meta.loggedIn,
      hostId: meta.hostId,
      historyDbPath: envConfig.HISTORY_DB_PATH,
      totalCommands: res?.commands ?? 0,
      totalHosts: res?.hosts ?? 0,
      totalSessions: res?.sessions ?? 0,
    };
  }

  /** Command counts per physical machine, with hostname variants merged. */
  static async byHost(): Promise<Array<{ hostname: string; count: number }>> {
    return getHistoryDb()
      .select({ hostname: this.machineExpr, count: count() })
      .from(clientHistory)
      .where(this.liveOnly())
      .groupBy(sql`1`)
      .orderBy(desc(count()));
  }

  /**
   * Most-run commands by first word. This is the signal that drives batch
   * pruning: on a typical history `cd`/`ls`/`cat` dominate and are pure noise.
   */
  static async topVerbs(limit = 20): Promise<VerbCount[]> {
    return getHistoryDb()
      .select({
        verb: sql<string>`substr(${clientHistory.command}, 1, instr(${clientHistory.command} || ' ', ' ') - 1)`,
        count: count(),
      })
      .from(clientHistory)
      .where(this.liveOnly())
      .groupBy(sql`1`)
      .orderBy(desc(count()))
      .limit(limit);
  }

  /**
   * What `atuin history dedup` would remove.
   *
   * dedup deletes entries sharing command, cwd and hostname, keeping one of
   * each group — so the removable count is total rows minus distinct groups.
   * Computed here rather than by running the command, because the CLI has no
   * dry-run and the confirm has to show a scope the user can actually inspect.
   */
  static async duplicatePreview(sampleSize = 20): Promise<{
    removable: number;
    groups: number;
    /** Identifies *which* duplicates these are, not merely how many. */
    fingerprint: string;
    sample: Array<{ command: string; copies: number }>;
  }> {
    const db = getHistoryDb();

    const grouped = await db
      .select({
        command: clientHistory.command,
        copies: count(),
      })
      .from(clientHistory)
      .where(this.liveOnly())
      .groupBy(clientHistory.command, clientHistory.cwd, clientHistory.hostname)
      .having(sql`count(*) > 1`)
      .orderBy(desc(count()))
      .limit(sampleSize);

    const [agg] = await db
      .select({
        removable: sql<number>`coalesce(sum(c - 1), 0)`,
        groups: sql<number>`count(*)`,
      })
      .from(
        db
          .select({ c: count().as("c") })
          .from(clientHistory)
          .where(this.liveOnly())
          .groupBy(clientHistory.command, clientHistory.cwd, clientHistory.hostname)
          .having(sql`count(*) > 1`)
          .as("dupes")
      );

    // A hash over the whole duplicate set: two different sets can share a
    // removable count, so the count alone cannot confirm the user is deleting
    // what they were shown.
    const [digest] = await db
      .select({
        value: sql<string>`group_concat(k, char(31))`,
      })
      .from(
        db
          .select({
            k: sql<string>`${clientHistory.command} || char(30) || ${clientHistory.cwd} || char(30) || ${clientHistory.hostname} || char(30) || count(*)`.as(
              "k"
            ),
          })
          .from(clientHistory)
          .where(this.liveOnly())
          .groupBy(clientHistory.command, clientHistory.cwd, clientHistory.hostname)
          .having(sql`count(*) > 1`)
          .orderBy(clientHistory.command, clientHistory.cwd, clientHistory.hostname)
          .as("keys")
      );

    const fingerprint = new Bun.CryptoHasher("sha256")
      .update(digest?.value ?? "")
      .digest("hex");

    return {
      removable: agg?.removable ?? 0,
      groups: agg?.groups ?? 0,
      fingerprint,
      sample: grouped,
    };
  }

  /** Daily command counts for the trailing `days` window. */
  static async activity(days = 30): Promise<Array<{ day: string; count: number }>> {
    const cutoff = (Date.now() - days * 86_400_000) * 1_000_000; // ns
    return getHistoryDb()
      .select({
        day: sql<string>`date(${clientHistory.timestamp} / 1000000000, 'unixepoch', 'localtime')`,
        count: count(),
      })
      .from(clientHistory)
      .where(and(this.liveOnly(), sql`${clientHistory.timestamp} >= ${cutoff}`))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  }
}
