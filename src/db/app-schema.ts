import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Dashboard-owned tables.
 *
 * Deliberately separate from `schema.ts` (atuin's sync-server tables) and
 * `history-schema.ts` (the atuin client's tables): those two databases belong
 * to atuin and run their own migrations. Drizzle manages only this file.
 */

/**
 * Record of every batch mutation the dashboard performed.
 *
 * Deletions are appended to atuin's record store and propagate to every synced
 * machine, so the dashboard cannot undo one. This log is the only trace of
 * what a prune actually removed.
 */
export const pruneAudit = sqliteTable(
  "prune_audit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "delete" | "delete-exact" | "delete-batch" | "purge-verbs" | "dedup" */
    action: text("action").notNull(),
    /** The atuin profile the action ran against. */
    profile: text("profile").notNull(),
    /** JSON-serialised SearchRule, null for parameterless actions. */
    rule: text("rule"),
    /** How many commands the preview matched before execution. */
    matchedCount: integer("matched_count").notNull().default(0),
    /**
     * First N matched commands, JSON array — the only record of what went.
     *
     * Redacted before storage (see AuditStore.redactCommand): shell history
     * routinely carries tokens inline, so an unredacted log would be a durable
     * copy of exactly the material a deletion was often meant to remove.
     */
    sample: text("sample"),
    /**
     * Superseded by {@link status}; kept so this change is a pure column
     * addition. Dropping it at the same time would make the migration a
     * rename-or-drop question that drizzle-kit can only resolve through an
     * interactive prompt — which the compiled binary's migration path has no
     * way to answer.
     *
     * @deprecated read `status`.
     */
    succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(true),

    /**
     * "pending" until the operation reports back, then "succeeded"/"failed".
     *
     * A boolean cannot distinguish "this failed" from "we never found out":
     * if the completing update is lost, a boolean row stays false and the
     * audit page claims a destructive operation failed when it in fact
     * succeeded.
     */
    status: text("status", { enum: ["pending", "succeeded", "failed"] })
      .notNull()
      .default("pending"),
    output: text("output"),
    createdAt: text("created_at")
      .notNull()
      // UTC, not localtime: rows written either side of a DST change or on a
      // machine in another zone otherwise sort and compare incoherently.
      // Rendered in local time at the UI boundary instead.
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_prune_audit_created").on(table.createdAt)]
);

export type PruneAuditRow = typeof pruneAudit.$inferSelect;
export type NewPruneAudit = typeof pruneAudit.$inferInsert;
