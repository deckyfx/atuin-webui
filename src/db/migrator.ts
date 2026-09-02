import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { getAppDb } from "./app";
import { envConfig } from "../env-config";
import { embeddedMigrations, embeddedMigrationCount } from "./migrations-embedded";

/**
 * Applies the migrations compiled into this build to the dashboard database.
 *
 * The SQL is imported as text at build time, so it survives into a compiled
 * binary. It is written back out to a real directory at startup because
 * Drizzle's migrator takes a folder path -- that keeps `__drizzle_migrations`
 * bookkeeping in Drizzle's hands rather than hand-rolled here.
 */
export class Migrator {
  private static readonly dir = join(envConfig.RUNTIME_CONFIG_DIR, ".migrations");

  /**
   * Rewrites the migration folder to match the running binary exactly.
   *
   * Stale files are removed first: rolling back to an older build would
   * otherwise leave a newer build's .sql on disk, which its journal cannot run.
   */
  private static async materialise(): Promise<void> {
    mkdirSync(join(this.dir, "meta"), { recursive: true });

    const expected = new Set(Object.keys(embeddedMigrations.files));
    let existing: string[] = [];
    try {
      existing = await readdir(this.dir);
    } catch {
      // First run: nothing to clean.
    }
    await Promise.all(
      existing
        .filter((f) => f.endsWith(".sql") && !expected.has(f))
        .map((f) => rm(join(this.dir, f), { force: true }))
    );

    writeFileSync(join(this.dir, "meta", "_journal.json"), embeddedMigrations.journal);
    for (const [name, sql] of Object.entries(embeddedMigrations.files)) {
      writeFileSync(join(this.dir, name), sql);
    }
  }

  /**
   * Runs pending migrations. Call before the server starts serving.
   *
   * @throws never -- exits the process on a packaging fault, because
   *         continuing guarantees "no such table" on the first query.
   */
  /**
   * Runs `fn` while holding an exclusive lock file.
   *
   * Uses exclusive create ("wx") rather than an advisory lock, which Bun does
   * not expose. A lock left behind by a killed process is reclaimed once it is
   * older than the timeout, so a crash cannot wedge every future start.
   */
  private static async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    // The lock now precedes materialise(), which used to create this
    // directory: without it the exclusive create fails with ENOENT forever.
    mkdirSync(envConfig.RUNTIME_CONFIG_DIR, { recursive: true });

    const lockPath = join(envConfig.RUNTIME_CONFIG_DIR, ".migrate.lock");
    const WAIT_MS = 120_000;
    const deadline = Date.now() + WAIT_MS;

    for (;;) {
      try {
        writeFileSync(lockPath, String(process.pid), { flag: "wx" });
        break;
      } catch {
        // Reclaimed on the holder being gone, not on the file being old: a
        // migration slower than any fixed age would otherwise have its lock
        // stolen while it was still running, which is exactly the case the
        // lock exists to prevent.
        if (!existsSync(lockPath)) {
          // The create failed for a reason other than contention (a bad path,
          // no permission). Spinning would hang the process forever.
          throw new Error(`Cannot create the migration lock at ${lockPath}.`);
        }
        if (!this.holderAlive(lockPath)) {
          rmSync(lockPath, { force: true });
          continue;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for another process to finish migrating (${lockPath}).`
          );
        }
        await Bun.sleep(100);
      }
    }

    try {
      return await fn();
    } finally {
      rmSync(lockPath, { force: true });
    }
  }

  /** Whether the process named in the lock file still exists. */
  private static holderAlive(lockPath: string): boolean {
    let pid: number;
    try {
      pid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    } catch {
      // Gone between the failed create and this read.
      return false;
    }
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return true;
    try {
      // Signal 0 tests for existence without delivering anything.
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM means it exists and belongs to another user.
      return (err as NodeJS.ErrnoException)?.code === "EPERM";
    }
  }

  static async run(): Promise<void> {
    if (embeddedMigrationCount === 0) {
      console.error(
        "❌ No migrations were compiled into this build — the database cannot be created."
      );
      console.error("💡 This is a packaging fault; please report it.");
      process.exit(1);
    }

    // The lock covers materialise() as well as the migration itself: writing
    // the .sql files is the part that races. Two instances materialising into
    // one directory can leave a half-written file for the other to run.
    await this.withLock(async () => {
      await this.materialise();
      migrate(getAppDb(), { migrationsFolder: this.dir });
    });
  }
}
