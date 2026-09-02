import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { envConfig } from "../env-config";
import * as historySchema from "./history-schema";

/** Thrown when the atuin client's data is not present on this machine. */
export class HistoryUnavailableError extends Error {
  constructor(readonly path: string) {
    super(
      `No atuin history database at ${path}. ` +
        `Install atuin and run \`atuin login\`, or set ATUIN_PROFILE/ATUIN_CLIENT_DATA_DIR.`
    );
    this.name = "HistoryUnavailableError";
  }
}

let cached: BunSQLiteDatabase<typeof historySchema> | null = null;
let checked = false;

/**
 * Read-only handle on the atuin client's history database.
 *
 * Opened lazily: a dashboard deployed to a machine where atuin is not yet set
 * up must still boot and render its setup screen, rather than dying at import
 * with SQLITE_CANTOPEN.
 *
 * Readonly on purpose -- the daemon holds this file in WAL mode, and every
 * mutation must go through the binary rather than SQL.
 */
export function getHistoryDb(): BunSQLiteDatabase<typeof historySchema> {
  if (cached) return cached;
  try {
    const sqlite = new Database(envConfig.HISTORY_DB_PATH, { readonly: true });
    // Wait rather than fail if the daemon is mid-write.
    sqlite.run("PRAGMA busy_timeout=5000;");
    cached = drizzle(sqlite, { schema: historySchema });
    checked = true;
    return cached;
  } catch {
    checked = true;
    throw new HistoryUnavailableError(envConfig.HISTORY_DB_PATH);
  }
}

/** True when the history database can be opened. Never throws. */
export function historyAvailable(): boolean {
  if (cached) return true;
  if (checked && !cached) {
    // Re-check: atuin may have been set up since the last attempt.
    checked = false;
  }
  try {
    getHistoryDb();
    return true;
  } catch {
    return false;
  }
}

/** Reads the client's `host_id` and login `session` from meta.db. */
export function readClientMeta(): { hostId?: string; loggedIn: boolean } {
  try {
    const meta = new Database(envConfig.META_DB_PATH, { readonly: true });
    const rows = meta
      .query<{ key: string; value: string }, []>(
        "select key, value from meta where key in ('host_id','session')"
      )
      .all();
    meta.close();

    const map = new Map(rows.map((r) => [r.key, r.value]));
    return { hostId: map.get("host_id"), loggedIn: Boolean(map.get("session")) };
  } catch {
    // meta.db absent => atuin is not set up on this machine.
    return { loggedIn: false };
  }
}
