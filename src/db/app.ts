import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { envConfig } from "../env-config";
import * as appSchema from "./app-schema";

let cached: BunSQLiteDatabase<typeof appSchema> | null = null;

/**
 * The dashboard's own database.
 *
 * Opened lazily like the other two: creating directories and a database file
 * as an import side effect means merely importing a module for its types
 * writes to disk, and a failure there takes down the process before any error
 * handling exists.
 */
export function getAppDb(): BunSQLiteDatabase<typeof appSchema> {
  if (cached) return cached;

  mkdirSync(dirname(envConfig.APP_DB_PATH), { recursive: true });
  const sqlite = new Database(envConfig.APP_DB_PATH, { create: true });
  sqlite.run("PRAGMA journal_mode=WAL;");
  // Long enough to cover a concurrent migration. Two instances starting
  // together both try to migrate, and drizzle's migrator does not retry: with
  // a short timeout the loser fails with "database is locked" instead of
  // waiting for the winner and then finding the work already done. This is
  // what serialises migrators — SQLite's own lock, not a lock file.
  sqlite.run("PRAGMA busy_timeout=30000;");
  cached = drizzle(sqlite, { schema: appSchema });
  return cached;
}
