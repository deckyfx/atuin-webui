import { desc } from "drizzle-orm";
import { appDb } from "../db/app";
import { pruneAudit } from "../db/app-schema";
import type { PruneAuditRow, NewPruneAudit } from "../db/app-schema";

/** Append-only log of the dashboard's destructive operations. */
export class AuditStore {
  /** Records one action. Never throws: an audit failure must not abort work
   *  that already happened, but it is surfaced on stderr. */
  static async record(entry: NewPruneAudit): Promise<void> {
    try {
      await appDb.insert(pruneAudit).values(entry);
    } catch (err) {
      console.error("audit: failed to record entry", err);
    }
  }

  static async recent(limit = 100): Promise<PruneAuditRow[]> {
    return appDb
      .select()
      .from(pruneAudit)
      .orderBy(desc(pruneAudit.id))
      .limit(limit);
  }
}
