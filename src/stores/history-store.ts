import { and, desc, eq, isNull, like, ne, sql, count } from "drizzle-orm";
import { getHistoryDb, readClientMeta } from "../db/history";
import { clientHistory } from "../db/history-schema";
import type { ClientHistoryRow } from "../db/history-schema";
import { envConfig } from "../env-config";
import { CATEGORIES } from "../lib/categories";
import { clusterNearDuplicates } from "../lib/similarity";

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
  private static machineExpr = sql<string>`(
    with h(name) as (
      select case when instr(${clientHistory.hostname}, ':') > 0
                  then substr(${clientHistory.hostname}, 1, instr(${clientHistory.hostname}, ':') - 1)
                  else ${clientHistory.hostname} end
    )
    -- Only a *terminal* .local: replace() would also strip it from the middle
    -- of a name like "my.local.box", merging two genuinely distinct machines.
    select case when name like '%.local' then substr(name, 1, length(name) - 6)
                else name end
    from h
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

  /**
   * Counts each purge category, plus what is left over.
   *
   * One pass with conditional sums rather than a query per category: the
   * categories overlap (an agent command is often also a `cd`), and counting
   * them independently would produce figures that sum to more than the
   * history. Each row is assigned to the first category it matches, in the
   * order they are declared, so the numbers add up.
   */
  static async categorise(): Promise<{
    total: number;
    categories: Array<{ id: string; count: number }>;
    remaining: number;
  }> {
    const db = getHistoryDb();

    // CASE assigns each row exactly once, in declaration order.
    const branches = CATEGORIES.map(
      (c, i) => sql.raw(`when ${c.predicate} then ${i}`)
    );
    const bucket = sql.join(
      [sql.raw("case"), ...branches, sql.raw(`else ${CATEGORIES.length} end`)],
      sql.raw(" ")
    );

    const rows = await db
      .select({ bucket: sql<number>`${bucket}`, count: count() })
      .from(clientHistory)
      .where(this.liveOnly())
      .groupBy(sql`1`);

    const byBucket = new Map(rows.map((r) => [Number(r.bucket), r.count]));
    const categories = CATEGORIES.map((c, i) => ({
      id: c.id,
      count: byBucket.get(i) ?? 0,
    }));

    return {
      total: rows.reduce((n, r) => n + r.count, 0),
      categories,
      remaining: byBucket.get(CATEGORIES.length) ?? 0,
    };
  }

  /**
   * Distinct commands in a category, for the exact-delete path.
   *
   * Capped: a category can hold thousands of unique commands, and the caller
   * deletes them one at a time. The cap is returned alongside so the UI can
   * say "this is a first batch" rather than implying the category is done.
   */
  static async commandsIn(
    categoryId: string,
    limit = 500
  ): Promise<{ commands: string[]; distinct: number }> {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) throw new Error(`Unknown category: ${categoryId}`);

    const db = getHistoryDb();
    const [totals] = await db
      .select({ distinct: sql<number>`count(distinct ${clientHistory.command})` })
      .from(clientHistory)
      .where(and(this.liveOnly(), sql.raw(category.predicate)));

    // Only commands that can actually be removed. A command that another
    // command strictly extends is refused by the prefix delete, and without
    // this filter those stay at the head of every page — a quarter of each
    // batch spent re-fetching commands that will never go.
    const deletable = sql`not exists (
      select 1 from ${clientHistory} ext
      where ext.deleted_at is null
        and ext.command like ${clientHistory.command} || '_%'
    )`;

    const rows = await db
      .selectDistinct({ command: clientHistory.command })
      .from(clientHistory)
      .where(and(this.liveOnly(), sql.raw(category.predicate), deletable))
      .limit(limit);

    // No blocked count here. Counting them means evaluating the NOT EXISTS
    // against every command in the category rather than stopping at `limit`,
    // which turned a 0.3s page into a 63s one. The filtered page is what the
    // caller needs; how many were excluded is reported once by the analysis
    // endpoint instead of on every page.
    return { commands: rows.map((r) => r.command), distinct: totals?.distinct ?? 0 };
  }

  /** A few examples of what a category holds, so a purge can be inspected. */
  static async sampleOf(categoryId: string, limit = 8): Promise<string[]> {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) throw new Error(`Unknown category: ${categoryId}`);

    const rows = await getHistoryDb()
      .selectDistinct({ command: clientHistory.command })
      .from(clientHistory)
      .where(and(this.liveOnly(), sql.raw(category.predicate)))
      .limit(limit);
    return rows.map((r) => r.command);
  }

  /**
   * Near-duplicate clusters at a similarity threshold.
   *
   * Distinct commands only: exact repeats are already handled by dedup, and
   * feeding them in would just produce clusters of identical text.
   */
  static async nearDuplicates(
    threshold: number,
    sampleSize = 10
  ): Promise<{
    threshold: number;
    clusters: number;
    removable: number;
    sample: Array<{ keep: string; remove: string[]; worst: number }>;
  }> {
    const rows = await getHistoryDb()
      .selectDistinct({ command: clientHistory.command })
      .from(clientHistory)
      .where(this.liveOnly());

    const clusters = clusterNearDuplicates(
      rows.map((r) => r.command),
      threshold
    );

    return {
      threshold,
      clusters: clusters.length,
      removable: clusters.reduce((n, c) => n + c.remove.length, 0),
      // Loosest matches first: those are the ones worth eyeballing before
      // accepting a threshold, because they are what it only just admitted.
      sample: [...clusters]
        .sort((a, b) => a.worst - b.worst)
        .slice(0, sampleSize)
        .map((c) => ({ keep: c.keep, remove: c.remove.slice(0, 3), worst: c.worst })),
    };
  }

  /** Every command a near-duplicate purge would remove, keeping one per cluster. */
  static async nearDuplicateRemovals(threshold: number, limit = 500): Promise<string[]> {
    const rows = await getHistoryDb()
      .selectDistinct({ command: clientHistory.command })
      .from(clientHistory)
      .where(this.liveOnly());

    return clusterNearDuplicates(rows.map((r) => r.command), threshold)
      .flatMap((c) => c.remove)
      .slice(0, limit);
  }

  /** How many live entries are exactly this command. */
  static async occurrencesOf(command: string): Promise<number> {
    const [row] = await getHistoryDb()
      .select({ n: count() })
      .from(clientHistory)
      .where(and(this.liveOnly(), eq(clientHistory.command, command)));
    return row?.n ?? 0;
  }

  /**
   * Commands that strictly extend `command`, i.e. what a prefix delete would
   * also remove.
   *
   * The same guard `AtuinCli.previewExact` provides, answered by the database
   * instead of a CLI search. For a multi-line heredoc the CLI form passes the
   * whole 2KB command as a prefix query and scans every row — about 300ms
   * each, twice per deletion. This is an indexed LIKE: microseconds, and it
   * sees the same rows the delete will.
   */
  static async overmatchesFor(command: string): Promise<number> {
    const [row] = await getHistoryDb()
      .select({ n: count() })
      .from(clientHistory)
      .where(
        and(
          this.liveOnly(),
          like(clientHistory.command, `${command}_%`),
          ne(clientHistory.command, command)
        )
      );
    return row?.n ?? 0;
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
      // Upper-bounded too: a future-dated row (clock skew on another machine)
      // otherwise lands inside a window the UI labels "last 30 days".
      .where(
        and(
          this.liveOnly(),
          sql`${clientHistory.timestamp} >= ${cutoff}`,
          sql`${clientHistory.timestamp} <= ${Date.now() * 1_000_000}`
        )
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  }
}
