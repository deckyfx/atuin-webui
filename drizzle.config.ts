import type { Config } from "drizzle-kit";

/**
 * Drizzle manages ONLY the dashboard's own database.
 *
 * It must never point at atuin's sync-server database or the client's
 * history.db: those are owned by atuin, which runs its own sqlx migrations.
 * Generating against them would emit CREATE TABLE statements for tables
 * another application already owns.
 */
export default {
  schema: "./src/db/app-schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.DASHBOARD_DB_PATH ??
      `${process.env.HOME}/.local/share/atuin-dashboard/dashboard.db`,
  },
} satisfies Config;
