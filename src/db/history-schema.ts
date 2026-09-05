import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

/**
 * The atuin *client* history table.
 *
 * This is a materialized view: atuin rebuilds it by replaying the append-only
 * encrypted record store (records.db). It is plaintext because the client
 * decrypted the records at sync time -- no key handling is needed to read it.
 *
 * Never write here. Mutations must be appended as records via the `atuin`
 * binary, otherwise they neither sync nor survive `atuin store rebuild`.
 */
export const clientHistory = sqliteTable("history", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp").notNull(),
  duration: integer("duration").notNull(),
  exit: integer("exit").notNull(),
  command: text("command").notNull(),
  cwd: text("cwd").notNull(),
  session: text("session").notNull(),
  hostname: text("hostname").notNull(),
  deletedAt: integer("deleted_at"),
  author: text("author"),
  intent: text("intent"),
  shell: text("shell"),
});

export type ClientHistoryRow = typeof clientHistory.$inferSelect;
