import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { appDb } from "./app";
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
  static async run(): Promise<void> {
    if (embeddedMigrationCount === 0) {
      console.error(
        "❌ No migrations were compiled into this build — the database cannot be created."
      );
      console.error("💡 This is a packaging fault; please report it.");
      process.exit(1);
    }

    await this.materialise();
    migrate(appDb, { migrationsFolder: this.dir });
  }
}
