import { AtuinCli } from "./atuin-cli";
import { findAtuinBin, managedBinPath, resolveTarget } from "./atuin-binary";
import { historyAvailable, readClientMeta } from "../db/history";
import { serverDbAvailable } from "../db";
import { envConfig } from "../env-config";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Present when the dashboard can fix this itself. */
  remedy?: "install-atuin" | "login";
}

export interface DoctorReport {
  /** False when something required is missing; the UI blocks on this. */
  healthy: boolean;
  profile: string;
  checks: Check[];
}

/**
 * Environment self-check.
 *
 * The dashboard depends on things it does not own -- the atuin binary, the
 * client's databases, a login session -- and each can be absent independently.
 * Reporting them individually turns "it's broken" into a specific next action.
 */
export class Doctor {
  static async run(): Promise<DoctorReport> {
    const checks: Check[] = [];

    // ── atuin binary ────────────────────────────────────────────────────────
    const bin = await findAtuinBin();
    const version = await AtuinCli.version();
    if (version) {
      checks.push({
        id: "atuin-binary",
        label: "atuin binary",
        status: "ok",
        detail:
          bin.source === "managed"
            ? `${version} — downloaded by the dashboard: ${bin.path}`
            : bin.source === "env"
              ? `${version} — from ATUIN_BIN: ${bin.path}`
              : `${version} — system install: ${bin.path}`,
      });
    } else {
      const target = resolveTarget();
      checks.push({
        id: "atuin-binary",
        label: "atuin binary",
        status: "fail",
        detail: target
          ? `Not found. The dashboard shells out to it for every mutation. It can be downloaded to ${managedBinPath()}.`
          : `Not found, and no release exists for ${process.platform}/${process.arch}. Install it and set ATUIN_BIN.`,
        remedy: target ? "install-atuin" : undefined,
      });
    }

    // ── client history database ─────────────────────────────────────────────
    const hasHistory = historyAvailable();
    checks.push({
      id: "history-db",
      label: "Client history database",
      status: hasHistory ? "ok" : "fail",
      detail: hasHistory
        ? envConfig.HISTORY_DB_PATH
        : `Not readable at ${envConfig.HISTORY_DB_PATH}. It appears after the client logs in and syncs.`,
    });

    // ── login session ───────────────────────────────────────────────────────
    const meta = readClientMeta();
    checks.push({
      id: "session",
      label: "Sync login",
      status: meta.loggedIn ? "ok" : "fail",
      detail: meta.loggedIn
        ? `Logged in — host_id ${meta.hostId ?? "unknown"}`
        : "No session token in meta.db. Log in to pull history from the sync server.",
      remedy: meta.loggedIn ? undefined : "login",
    });

    // ── dashboard's own database ────────────────────────────────────────────
    let appDbOk = true;
    let appDbDetail = envConfig.APP_DB_PATH;
    try {
      const { AuditStore } = await import("../stores/audit-store");
      // Probes the table the app actually needs: an openable file whose
      // migrations never ran is not a working database.
      await AuditStore.recent(1);
    } catch (err) {
      appDbOk = false;
      appDbDetail = `${envConfig.APP_DB_PATH} — ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
    checks.push({
      id: "app-db",
      label: "Dashboard database",
      status: appDbOk ? "ok" : "fail",
      detail: appDbDetail,
    });

    // ── sync-server database (optional) ─────────────────────────────────────
    const hasServerDb = serverDbAvailable();
    checks.push({
      id: "server-db",
      label: "Sync-server database",
      status: hasServerDb ? "ok" : "warn",
      detail: hasServerDb
        ? envConfig.SERVER_DB_PATH
        : "Not configured. Optional — only the Users/Sessions/Activity admin pages need it.",
    });

    // A warn is informational; only a fail blocks.
    const healthy = !checks.some((c) => c.status === "fail");
    return { healthy, profile: envConfig.PROFILE, checks };
  }
}
