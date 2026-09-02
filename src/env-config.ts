import { homedir } from "node:os";
import { join } from "node:path";

/** Which atuin client profile the dashboard drives. */
export type AtuinProfile = "live" | "sandbox";

/**
 * Runtime configuration for the dashboard.
 *
 * The dashboard never re-implements atuin's sync or crypto: it reads the
 * client's plaintext `history.db` and mutates through the `atuin` binary.
 * Credentials are therefore only needed to *bootstrap* a client that has
 * never logged in (a fresh container, or the sandbox). Once `meta.db` holds
 * a session token, sync needs no credentials at all.
 */
class EnvConfig {
  private static instance: EnvConfig;

  private constructor() {
    this.validate();
  }

  static getInstance(): EnvConfig {
    if (!EnvConfig.instance) {
      EnvConfig.instance = new EnvConfig();
    }
    return EnvConfig.instance;
  }

  private validate(): void {
    if (this.PROFILE !== "live" && this.PROFILE !== "sandbox") {
      throw new Error(
        `Invalid ATUIN_PROFILE: "${this.PROFILE}". Expected "live" or "sandbox".`
      );
    }

    if (this.KEY_INLINE && this.KEY_FILE) {
      throw new Error(
        "Set either ATUIN_KEY_FILE or ATUIN_KEY, not both. Prefer ATUIN_KEY_FILE."
      );
    }
  }

  /** Selects which client profile to drive. Defaults to the sandbox, so a
   *  misconfigured run cannot touch real history. */
  get PROFILE(): AtuinProfile {
    return (Bun.env.ATUIN_PROFILE ?? "sandbox") as AtuinProfile;
  }

  /** Client data dir: holds history.db, records.db, meta.db and key. */
  get CLIENT_DATA_DIR(): string {
    const explicit = Bun.env.ATUIN_CLIENT_DATA_DIR;
    if (explicit) return explicit;
    return this.PROFILE === "live"
      ? join(homedir(), ".local", "share", "atuin")
      : join(process.cwd(), "sandbox", "clients", "alpha", "data", "atuin");
  }

  /** Client config dir, passed to the binary as ATUIN_CONFIG_DIR. */
  get CLIENT_CONFIG_DIR(): string {
    const explicit = Bun.env.ATUIN_CLIENT_CONFIG_DIR;
    if (explicit) return explicit;
    return this.PROFILE === "live"
      ? join(homedir(), ".config", "atuin")
      : join(process.cwd(), "sandbox", "clients", "alpha", "config", "atuin");
  }

  /** Plaintext history, already decrypted by the client at sync time. */
  get HISTORY_DB_PATH(): string {
    return join(this.CLIENT_DATA_DIR, "history.db");
  }

  /** Holds the `session` token and `host_id` keys. */
  get META_DB_PATH(): string {
    return join(this.CLIENT_DATA_DIR, "meta.db");
  }

  /** XDG_DATA_HOME to hand the binary so it resolves CLIENT_DATA_DIR.
   *  See atuin crates/atuin-common/src/utils.rs data_dir(). */
  get XDG_DATA_HOME(): string {
    return join(this.CLIENT_DATA_DIR, "..");
  }

  /** Sync server. Only consulted during bootstrap; afterwards the client's
   *  own config.toml governs. */
  get SYNC_ADDRESS(): string | undefined {
    return Bun.env.ATUIN_SYNC_ADDRESS;
  }

  get USERNAME(): string | undefined {
    return Bun.env.ATUIN_USERNAME;
  }

  /** Bootstrap-only. Never needed once a session token exists. */
  get PASSWORD(): string | undefined {
    return Bun.env.ATUIN_PASSWORD;
  }

  /** Path to a file containing the bip39 key. Preferred over KEY_INLINE:
   *  keeps the secret at 0600 outside the repo. */
  get KEY_FILE(): string | undefined {
    return Bun.env.ATUIN_KEY_FILE;
  }

  /** Inline bip39 key. Container-bootstrap fallback only. */
  get KEY_INLINE(): string | undefined {
    return Bun.env.ATUIN_KEY;
  }

  /** Resolves the bootstrap key from file or inline, whichever is set. */
  async resolveKey(): Promise<string | undefined> {
    if (this.KEY_FILE) return (await Bun.file(this.KEY_FILE).text()).trim();
    return this.KEY_INLINE?.trim();
  }

  /** True when a sync-server database is configured. */
  get HAS_SERVER_DB(): boolean {
    return Boolean(Bun.env.ATUIN_SERVER_DB_PATH ?? Bun.env.ATUIN_DB_PATH);
  }

  /**
   * Read-only path to the sync server's own SQLite db, used for the
   * user/session admin views. Its `history.data` and `store.data` columns are
   * E2E-encrypted and can never yield command text -- that comes from
   * {@link HISTORY_DB_PATH} instead.
   *
   * Falls back to the legacy ATUIN_DB_PATH name.
   *
   * @throws if neither ATUIN_SERVER_DB_PATH nor ATUIN_DB_PATH is set.
   */
  get SERVER_DB_PATH(): string {
    const path = Bun.env.ATUIN_SERVER_DB_PATH ?? Bun.env.ATUIN_DB_PATH;
    if (!path) {
      throw new Error(
        "Missing required env var: ATUIN_SERVER_DB_PATH\n" +
        "Set it to your self-hosted Atuin server's SQLite database.\n" +
        "Example: ATUIN_SERVER_DB_PATH=/DATA/AppData/atuin/atuin.db"
      );
    }
    return path;
  }

  /**
   * Directory the dashboard owns for its own state: its SQLite database and
   * the migrations materialised out of the compiled binary.
   */
  get RUNTIME_CONFIG_DIR(): string {
    return (
      Bun.env.DASHBOARD_CONFIG_DIR ??
      join(homedir(), ".local", "share", "atuin-dashboard")
    );
  }

  /** The dashboard's own database. Never an atuin-owned file. */
  get APP_DB_PATH(): string {
    return Bun.env.DASHBOARD_DB_PATH ?? join(this.RUNTIME_CONFIG_DIR, "dashboard.db");
  }

  /**
   * atuin release to fetch when no binary is present.
   *
   * Read at runtime rather than compiled in, so upgrading atuin is an env
   * change and a restart — not a dashboard image rebuild.
   */
  get ATUIN_VERSION(): string {
    return Bun.env.ATUIN_VERSION ?? "18.20.1";
  }

  /** Explicit path to an atuin binary, overriding discovery. */
  get ATUIN_BIN(): string | undefined {
    return Bun.env.ATUIN_BIN;
  }

  get PORT(): number {
    const port = Bun.env.PORT;
    return port ? parseInt(port, 10) : 3001;
  }

  get NODE_ENV(): string {
    return Bun.env.NODE_ENV ?? "development";
  }
}

export const envConfig = EnvConfig.getInstance();
