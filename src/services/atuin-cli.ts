import { envConfig } from "../env-config";
import { resolveAtuinBin } from "./atuin-binary";

/** Matching strategy passed to `atuin search --search-mode`. */
export type SearchMode = "prefix" | "full-text" | "fuzzy" | "skim";

/**
 * Modes offered by the dashboard. "exact" is not an atuin mode: the CLI has
 * no whole-string matcher, so it is bridged here (prefix search, then filtered
 * in code). See {@link AtuinCli.previewExact}.
 */
export type UiSearchMode = SearchMode | "exact";

/** Scope passed to `atuin search --filter-mode`. */
export type FilterMode = "global" | "host" | "session" | "directory" | "workspace";

/** A batch-selection rule. The same rule drives preview and delete, so what
 *  the user confirms is exactly what gets removed. */
export interface SearchRule {
  query: string;
  searchMode?: SearchMode;
  filterMode?: FilterMode;
  /** Restrict to a working directory. */
  cwd?: string;
  /** Restrict to an exit code. */
  exit?: number;
  /** Natural-language dates, e.g. "30 days ago". */
  before?: string;
  after?: string;
  limit?: number;
}

export interface PreviewResult {
  /** Entries that will actually be deleted, duplicates included. */
  total: number;
  /** Distinct command strings among them. */
  unique: number;
  /** Distinct commands, capped, for display. */
  sample: string[];
}

export interface ExactPreview {
  /** Entries whose command equals the query exactly. */
  total: number;
  /** Distinct commands that merely *start with* the query and would be
   *  collateral damage if the prefix delete ran. Empty means exact is safe. */
  overmatches: string[];
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Thin wrapper over the `atuin` binary.
 *
 * Every mutation the dashboard performs goes through here rather than through
 * SQL. The binary is the only correct implementation of record encryption,
 * per-record CEK wrapping and per-host `idx` sequencing -- writing rows
 * directly into history.db would neither sync nor survive a store rebuild.
 */
/**
 * How long any single `atuin` invocation may take.
 *
 * Generous: a first sync over a slow link is legitimately slow. The point is
 * to have a ceiling at all, not to be tight.
 */
const COMMAND_TIMEOUT_MS = 120_000;

export class AtuinCli {
  /**
   * Environment that pins the binary to the configured profile.
   * See atuin crates/atuin-common/src/utils.rs: config_dir() reads
   * ATUIN_CONFIG_DIR, data_dir() reads XDG_DATA_HOME.
   */
  /** Lazily-generated session id, reused for the process lifetime. */
  private static sessionId?: string;

  /**
   * `atuin search` refuses to run without $ATUIN_SESSION, which a shell
   * normally exports during init. The dashboard is not a shell, so it mints
   * one id per process -- the value only groups commands by shell session and
   * does not affect global-scoped searches.
   */
  private static async session(): Promise<string> {
    if (!this.sessionId) {
      let out = "";
      try {
        const proc = Bun.spawn([await resolveAtuinBin(), "uuid"], { stdout: "pipe", stderr: "ignore" });
        // Exit status first: a non-zero run can still have written partial
        // output, and a truncated uuid is worse than the random fallback
        // because it looks like a real session id.
        const [text, code] = await Promise.all([
          new Response(proc.stdout).text(),
          proc.exited,
        ]);
        out = code === 0 ? text.trim() : "";
      } catch {
        // Binary missing: fall back so run() can report the real problem.
      }
      this.sessionId = out || crypto.randomUUID().replace(/-/g, "");
    }
    return this.sessionId;
  }

  private static async env(): Promise<Record<string, string>> {
    return {
      PATH: Bun.env.PATH ?? "/usr/bin:/bin",
      HOME: Bun.env.HOME ?? "",
      ATUIN_SESSION: await this.session(),
      ATUIN_CONFIG_DIR: envConfig.CLIENT_CONFIG_DIR,
      XDG_DATA_HOME: envConfig.XDG_DATA_HOME,
    };
  }

  /**
   * Runs the binary and captures its output.
   *
   * Never throws: a missing binary is reported as a failed result, so a
   * dashboard shipped to a machine (or container) without atuin degrades to a
   * clear message instead of an opaque 500.
   */
  private static async run(args: string[]): Promise<CommandResult> {
    let proc;
    try {
      proc = Bun.spawn([await resolveAtuinBin(), ...args], {
        env: await this.env(),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
    } catch {
      return {
        ok: false,
        stdout: "",
        stderr:
          "The `atuin` binary was not found on PATH. Install atuin on this host " +
          "(or into the image) — the dashboard shells out to it for every mutation.",
        exitCode: 127,
      };
    }

    // Bounded. `atuin` can block indefinitely — a database lock held by the
    // daemon, a sync against an unreachable server — and this runs inside an
    // HTTP handler, so an unbounded wait ties up the request until the client
    // gives up with no explanation.
    const timer = setTimeout(() => proc.kill(), COMMAND_TIMEOUT_MS);
    let stdout = "";
    let stderr = "";
    let exitCode: number;
    try {
      [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      exitCode = await proc.exited;
    } catch (err) {
      // A failed read is reported as a failed command, not thrown: callers
      // treat a non-ok result as "this did not work", and letting a stream
      // error escape here would surface as an unhandled 500 instead.
      proc.kill();
      return {
        ok: false,
        stdout,
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: -1,
      };
    } finally {
      clearTimeout(timer);
    }

    if (proc.killed && exitCode !== 0) {
      return {
        ok: false,
        stdout,
        stderr:
          stderr.trim() ||
          `atuin did not finish within ${COMMAND_TIMEOUT_MS / 1000}s and was stopped.`,
        exitCode,
      };
    }

    return { ok: exitCode === 0, stdout, stderr, exitCode };
  }

  /** Whether the binary is present. Cached for the process lifetime. */
  private static installed?: boolean;

  static async isInstalled(): Promise<boolean> {
    if (this.installed === undefined) {
      this.installed = (await this.run(["--version"])).ok;
    }
    return this.installed;
  }

  /** Clears the cached probe after an install changes what is on disk. */
  static forgetInstalled(): void {
    this.installed = undefined;
    this.sessionId = undefined;
  }

  /** Reported version string, or null when the binary is absent. */
  static async version(): Promise<string | null> {
    const res = await this.run(["--version"]);
    return res.ok ? res.stdout.trim().split("\n")[0] ?? null : null;
  }

  /**
   * Builds `atuin search` arguments for a rule.
   *
   * `extra` is spliced in before the positional query on purpose: atuin's
   * parser rejects flags that appear after the positional, so the query must
   * always be the final argument.
   */
  static searchArgs(rule: SearchRule, extra: string[]): string[] {
    const args: string[] = [
      "search",
      "--search-mode", rule.searchMode ?? "full-text",
      "--filter-mode", rule.filterMode ?? "global",
    ];
    if (rule.cwd) args.push("--cwd", rule.cwd);
    if (rule.exit !== undefined) args.push("--exit", String(rule.exit));
    if (rule.before) args.push("--before", rule.before);
    if (rule.after) args.push("--after", rule.after);
    if (rule.limit !== undefined) args.push("--limit", String(rule.limit));
    args.push(...extra);

    // An empty query must never reach the CLI. `atuin search` with no
    // positional matches every entry, so dropping the argument turns "match
    // nothing" into "match everything" — 6,455 rows on the history this was
    // measured against — and deleteMatching would append deletion records for
    // all of them on every synced machine. Callers guard this today; the
    // primitive refuses so that remains true when a new caller appears.
    if (!rule.query) {
      throw new Error(
        "Refusing to build an atuin search with an empty query: it would match every entry."
      );
    }
    args.push(rule.query);
    return args;
  }

  /**
   * Distinguishes "no matches" from a real search failure.
   *
   * `atuin search` exits 1 when nothing matched, which is an answer rather
   * than an error. It writes to stderr only for genuine faults (a missing
   * $ATUIN_SESSION, an unreadable database), so an empty stderr with no output
   * means the query simply found nothing.
   *
   * The distinction has to be made carefully: silently turning a real failure
   * into "0 matches" would read as "this rule is safe" immediately before a
   * delete that would in fact match plenty.
   */
  /**
   * The "matched nothing" convention, in one place.
   *
   * Exit 1 specifically: that is the code atuin uses for an empty result.
   * Treating any non-zero exit this way would silently swallow a killed
   * process (SIGKILL, 137) or a missing binary (127) as "this rule is safe" —
   * immediately before a delete. Two copies of this test could drift apart,
   * and the preview and the delete must agree on what "nothing" means.
   */
  private static matchedNothing(res: CommandResult): boolean {
    return res.exitCode === 1 && !res.stderr.trim() && res.stdout.length === 0;
  }

  private static assertSearchOk(res: CommandResult): void {
    if (res.ok || this.matchedNothing(res)) return;
    throw new Error(res.stderr.trim() || `atuin search failed (exit ${res.exitCode})`);
  }

  /**
   * Lists what {@link deleteMatching} would remove.
   *
   * Runs the identical query without `--delete`, plus `--include-duplicates`:
   * atuin deduplicates search output for display but `--delete` does not, so
   * without it the preview understates the damage (7,516 shown against 8,497
   * actually removed, on one real history). The count must be the number of
   * entries that will go; the sample is deduplicated only for readability.
   */
  static async previewDelete(rule: SearchRule): Promise<PreviewResult> {
    const res = await this.run(
      this.searchArgs(rule, ["--cmd-only", "--print0", "--include-duplicates"])
    );
    this.assertSearchOk(res);

    const matches = res.stdout.split("\0").filter((c) => c.length > 0);
    const unique = [...new Set(matches)];
    return { total: matches.length, unique: unique.length, sample: unique.slice(0, 200) };
  }

  /**
   * Appends deletion records for everything matching the rule.
   *
   * Carries `--include-duplicates` so the argument list matches the preview's
   * exactly. atuin deletes every matching entry either way, but a preview and
   * a delete that differ in their flags are one upstream change away from
   * differing in their results, and the whole confirm step rests on them
   * being the same query.
   */
  static async deleteMatching(rule: SearchRule): Promise<CommandResult> {
    const res = await this.run(this.searchArgs(rule, ["--delete", "--include-duplicates"]));
    // A delete that removed nothing because there was nothing to remove is a
    // success, not a failure to report to the user.
    return this.matchedNothing(res) ? { ...res, ok: true } : res;
  }

  /**
   * Preview for the bridged "exact" mode.
   *
   * atuin has no whole-string search, so this runs a prefix search and filters
   * the results in code. The filtering is honest about what it cannot do:
   * deletion still goes through a prefix query, so anything that merely starts
   * with the target would be swept up too. Those are returned as
   * `overmatches`, and {@link deleteExact} refuses while any exist.
   */
  static async previewExact(command: string): Promise<ExactPreview> {
    const res = await this.run(
      this.searchArgs(
        { query: command, searchMode: "prefix", filterMode: "global" },
        ["--cmd-only", "--print0", "--include-duplicates"]
      )
    );
    this.assertSearchOk(res);

    const matches = res.stdout.split("\0").filter((c) => c.length > 0);
    const total = matches.filter((c) => c === command).length;
    const overmatches = [...new Set(matches.filter((c) => c !== command))];
    return { total, overmatches };
  }

  /**
   * Deletes every entry whose command is exactly `command`.
   *
   * Refuses when a prefix delete would also remove longer commands, because
   * the CLI cannot express "this string and nothing longer" — running it
   * anyway would silently delete more than the caller asked for, across every
   * synced machine, with no undo.
   *
   * Note this removes *all* occurrences of the command, not one entry: atuin
   * deletes by query, and there is no delete-by-id.
   */
  static async deleteExact(
    command: string
  ): Promise<CommandResult & { refused?: ExactPreview }> {
    // Re-checked immediately before the delete rather than trusting an
    // earlier preview: the CLI cannot express "this string and nothing
    // longer", so the guard is a check-then-act. A command that arrives
    // between this check and the delete would still be swept up; the window
    // is milliseconds, and the alternative is dropping per-command delete
    // entirely.
    const preview = await this.previewExact(command);
    if (preview.overmatches.length > 0) {
      return {
        ok: false,
        stdout: "",
        stderr:
          `Refusing: a prefix delete for this command would also remove ` +
          `${preview.overmatches.length} longer command(s). atuin cannot express an ` +
          `exact-only delete.`,
        exitCode: 1,
        refused: preview,
      };
    }
    return this.deleteMatching({
      query: command,
      searchMode: "prefix",
      filterMode: "global",
    });
  }

  /**
   * Previews a whole-verb purge: everything invoking `verb`.
   *
   * The query carries a trailing space on purpose. A bare "ls" prefix also
   * matches lsof and lsblk -- 135 entries of real history on one machine --
   * so purging a verb by its bare prefix silently deletes neighbours that
   * merely share an opening. "ls " cannot.
   *
   * A bare `verb` with no arguments is therefore not covered; it is reported
   * separately rather than swept in, because removing it needs a bare-prefix
   * delete that would take the neighbours too.
   */
  /**
   * Rejects a verb that would build a meaningless rule.
   *
   * The query is `verb + " "`, so a blank verb yields a lone space: non-empty
   * enough to pass the query check, but a "commands starting with a space"
   * rule that nobody asked for.
   */
  private static normalisedVerb(verb: string): string {
    const trimmed = verb.trim();
    if (!trimmed) {
      throw new Error("Refusing to purge an empty query: it does not name a command.");
    }
    // Returned rather than validated in place: previewVerb and deleteVerb must
    // build the *same* query, and each trimming separately is how they drift.
    return trimmed;
  }

  static async previewVerb(
    verb: string
  ): Promise<PreviewResult & { verb: string; bare: number }> {
    const name = this.normalisedVerb(verb);
    const preview = await this.previewDelete({
      query: `${name} `,
      searchMode: "prefix",
      filterMode: "global",
    });

    // Count bare invocations separately so the total is explainable: the chip
    // counts every use of the verb, this purge covers only the ones with
    // arguments, and an unexplained gap between the two reads as a bug.
    let bare = 0;
    try {
      bare = (await this.previewExact(name)).total;
    } catch {
      // Non-fatal: the purge scope is unaffected, only the explanation.
    }

    return { verb: name, bare, ...preview };
  }

  /** Deletes everything invoking `verb`. See {@link previewVerb} on scope. */
  static async deleteVerb(verb: string): Promise<CommandResult> {
    const name = this.normalisedVerb(verb);
    return this.deleteMatching({
      query: `${name} `,
      searchMode: "prefix",
      filterMode: "global",
    });
  }

  /** Deletes duplicate entries sharing command, cwd and hostname. */
  static async dedup(): Promise<CommandResult> {
    return this.run(["history", "dedup"]);
  }

  /** Deletes entries matching the client's configured exclusion filters. */
  static async prune(): Promise<CommandResult> {
    return this.run(["history", "prune"]);
  }

  /** Pushes and pulls records with the sync server. */
  static async sync(): Promise<CommandResult> {
    return this.run(["sync"]);
  }

  static async status(): Promise<CommandResult> {
    return this.run(["status"]);
  }

  /**
   * One-time bootstrap for a client that has never logged in.
   *
   * Both secrets go through argv, and are therefore briefly readable in
   * /proc by other users on the host. This is not preventable through the
   * CLI: `atuin login` reads the password with rpassword, which requires a
   * TTY and rejects a pipe; there is no --password-stdin; and pre-writing
   * data_dir/key does not help because login clears it before prompting.
   *
   * What bounds it instead: the dashboard binds loopback by default, this
   * endpoint refuses once a session exists, and neither value is persisted
   * by the dashboard. On a shared host, run `atuin login` by hand and skip
   * this flow.
   *
   * Nothing here is persisted by the dashboard: atuin stores the resulting
   * session token in meta.db and the key at data_dir/key.
   */
  static async login(params: {
    username: string;
    password: string;
    key: string;
  }): Promise<CommandResult> {
    return this.run([
      "login",
      "-u", params.username,
      "-p", params.password,
      "-k", params.key,
    ]);
  }
}
