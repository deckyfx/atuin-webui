import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { envConfig } from "../env-config";
import * as schema from "./schema";

/** Thrown when the sync-server database is not reachable from this host. */
export class ServerDbUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
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
    // Read-write, because the admin pages revoke sessions and delete users --
    // but `create: false`, so a mistyped path is an error rather than a new
    // empty database.
    //
    // No journal_mode pragma: this database belongs to the atuin server, and
    // changing its journal mode from here would reconfigure another process's
    // storage as a side effect of opening it. busy_timeout is per-connection
    // and safe.
    const sqlite = new Database(path, { create: false, readwrite: true });
    sqlite.run("PRAGMA busy_timeout=5000;");
    cached = drizzle(sqlite, { schema });
    return cached;
  } catch (err) {
    // Distinguished by which call failed, not by matching message text: the
    // config getter throws before the database is touched, and its message is
    // already the actionable one.
    if (!envConfig.HAS_SERVER_DB) {
      throw new ServerDbUnavailableError(
        err instanceof Error ? err.message : String(err)
      );
    }
    throw new ServerDbUnavailableError(
      `Cannot open the atuin server database at ${Bun.env.ATUIN_SERVER_DB_PATH ?? Bun.env.ATUIN_DB_PATH}. ` +
        `Leave ATUIN_SERVER_DB_PATH unset to hide the sync-server admin pages.`,
      { cause: err }
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
