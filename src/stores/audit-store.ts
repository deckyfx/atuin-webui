import { desc, eq } from "drizzle-orm";
import { appDb } from "../db/app";
import { pruneAudit } from "../db/app-schema";
import type { PruneAuditRow, NewPruneAudit } from "../db/app-schema";

/**
 * Patterns that commonly carry a secret inline in a shell command.
 *
 * Shell history routinely contains tokens: `curl -H "Authorization: Bearer …"`,
 * `mysql -pHUNTER2`, `export AWS_SECRET_ACCESS_KEY=…`. The audit log records
 * what was deleted, so without redaction it becomes a durable copy of exactly
 * the material the deletion was often meant to remove.
 */
/**
 * A secret value: a single-quoted string, a double-quoted string, or an
 * unquoted run of non-space characters.
 *
 * Quoted forms come first and are matched whole, and an unquoted word absorbs
 * backslash escapes. Stopping at the first space leaves the tail of a
 * passphrase in the log — both `--password "correct horse"` and
 * `--password correct\ horse` would persist `horse` — which defeats the point
 * of redacting at all.
 */
const VALUE = String.raw`(?:'[^']*'|"[^"]*"|(?:\\.|\S)+)`;

const REDACTIONS: Array<[RegExp, string]> = [
  // --password=… / --token … / -p …
  [new RegExp(String.raw`(-{1,2}(?:password|passwd|pwd|token|secret|api[-_]?key)[=\s])${VALUE}`, "gi"),
    "$1«redacted»"],
  // FOO_TOKEN=… in an assignment or export
  [new RegExp(String.raw`\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z0-9_]*=)${VALUE}`, "g"),
    "$1«redacted»"],
  // Authorization: Bearer …  (often inside a quoted header argument)
  [new RegExp(String.raw`(Authorization:\s*(?:Bearer|Basic)\s+)[^"']+`, "gi"),
    "$1«redacted»"],
  // MySQL-style attached password: -pSECRET
  [new RegExp(String.raw`(-p)(?=\S)${VALUE}`, "g"), "$1«redacted»"],
  // Long opaque blobs: JWTs, hex keys.
  [/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "«redacted-jwt»"],
  [/\b[0-9a-f]{40,}\b/gi, "«redacted-hex»"],
];

/** Masks likely secrets in a command before it is persisted. */
export function redactCommand(command: string): string {
  return REDACTIONS.reduce((acc, [re, to]) => acc.replace(re, to), command);
}

export interface AuditIntent {
  action: string;
  profile: string;
  rule?: string;
  matchedCount?: number;
  /** Raw commands; redacted here before they reach the database. */
  sample?: string[];
}

/**
 * Append-only log of the dashboard's destructive operations.
 *
 * The intent is written *before* the operation runs and completed afterwards.
 * Recording only on the way out meant a crash mid-delete left no trace of a
 * change that had already propagated to every synced machine.
 */
export class AuditStore {
  /**
   * Records what is about to happen and returns the row id.
   *
   * Throws rather than swallowing: if the log cannot be written there will be
   * no record of an irreversible deletion, so the caller must abort instead of
   * proceeding blind.
   */
  static async begin(intent: AuditIntent): Promise<number> {
    const row: NewPruneAudit = {
      action: intent.action,
      profile: intent.profile,
      // The rule carries the user's search query, which is itself a fragment
      // of a command and can contain the secret they were trying to purge.
      rule: intent.rule ? redactCommand(intent.rule) : null,
      matchedCount: intent.matchedCount ?? 0,
      sample: intent.sample ? JSON.stringify(intent.sample.map(redactCommand)) : null,
      status: "pending",
      // Deprecated column is NOT NULL; kept truthful rather than defaulted.
      succeeded: false,
      output: null,
    };
    const [inserted] = await appDb.insert(pruneAudit).values(row).returning({
      id: pruneAudit.id,
    });
    if (!inserted) throw new Error("Audit log write returned no row.");
    return inserted.id;
  }

  /** Marks a previously begun entry with its outcome. */
  static async complete(
    id: number,
    result: { succeeded: boolean; output?: string; matchedCount?: number }
  ): Promise<void> {
    try {
      await appDb
        .update(pruneAudit)
        .set({
          status: result.succeeded ? "succeeded" : "failed",
          succeeded: result.succeeded,
          // CLI output echoes matched command text back, so it needs the same
          // treatment as the sample.
          output: result.output ? redactCommand(result.output).slice(0, 4000) : null,
          ...(result.matchedCount === undefined ? {} : { matchedCount: result.matchedCount }),
        })
        .where(eq(pruneAudit.id, id));
    } catch (err) {
      // The operation already ran. The row stays "pending", which reads as
      // "outcome unknown" rather than falsely claiming the deletion failed.
      console.error("audit: failed to complete entry", id, err);
    }
  }

  static async recent(limit = 100): Promise<PruneAuditRow[]> {
    return appDb.select().from(pruneAudit).orderBy(desc(pruneAudit.id)).limit(limit);
  }
}
