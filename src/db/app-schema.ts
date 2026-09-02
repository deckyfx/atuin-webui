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
    /** First N matched commands, JSON array -- the only record of what went. */
    sample: text("sample"),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(true),
    output: text("output"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now','localtime'))`),
  },
  (table) => [index("idx_prune_audit_created").on(table.createdAt)]
);

export type PruneAuditRow = typeof pruneAudit.$inferSelect;
export type NewPruneAudit = typeof pruneAudit.$inferInsert;
