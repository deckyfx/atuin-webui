import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { envConfig } from "../env-config";
import * as schema from "./schema";

/** Thrown when the sync-server database is not reachable from this host. */
export class ServerDbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerDbUnavailableError";
  }
}

let cached: BunSQLiteDatabase<typeof schema> | null = null;

/**
 * Read handle on the atuin *sync server's* database.
 *
 * Optional: the dashboard ships as a container that runs beside the atuin
 * stack, where this volume may not be mounted at all. Opened lazily so its
 * absence disables the admin pages rather than preventing boot.
 *
 * Its history and store payloads are E2E-encrypted and can never yield command
 * text -- that comes from the client's history.db.
 */
export function getServerDb(): BunSQLiteDatabase<typeof schema> {
  if (cached) return cached;
  try {
    const path = envConfig.SERVER_DB_PATH;
    // `new Database(path)` creates the file when it is absent, so a typo in
    // ATUIN_SERVER_DB_PATH silently produced an empty database and the admin
    // pages reported zero users instead of a misconfiguration.
    const sqlite = new Database(path, { create: false, readwrite: true });
    // WAL for concurrent access alongside the running atuin server.
    sqlite.run("PRAGMA journal_mode=WAL;");
    sqlite.run("PRAGMA busy_timeout=5000;");
    cached = drizzle(sqlite, { schema });
    return cached;
  } catch (err) {
    throw new ServerDbUnavailableError(
      err instanceof Error && err.message.includes("ATUIN_SERVER_DB_PATH")
        ? err.message
        : `Cannot open the atuin server database. Set ATUIN_SERVER_DB_PATH, or leave it unset to hide the sync-server admin pages.`
    );
  }
}

/** True when the sync-server admin pages have data to show. Never throws. */
export function serverDbAvailable(): boolean {
  if (!envConfig.HAS_SERVER_DB) return false;
  try {
    getServerDb();
    return true;
  } catch {
    return false;
  }
}
