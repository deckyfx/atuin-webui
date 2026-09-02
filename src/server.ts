import { Elysia } from "elysia";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { envConfig } from "./env-config";
import { Migrator } from "./db/migrator";

// Bring the dashboard's own database up to date before serving.
//
// A failure here is recorded rather than fatal. Doctor exists to explain
// exactly this kind of problem, and exiting takes down the one page that could
// report it -- the same reasoning that makes a missing atuin client a
// serve-and-explain state rather than a refusal to boot.
let migrationError: string | null = null;
try {
  await Migrator.run();
} catch (err) {
  migrationError = err instanceof Error ? err.message : String(err);
  console.error("Migration failed; the dashboard's own database is unavailable.");
  console.error(migrationError);
}

export { migrationError };

const app = new Elysia()
  .use(apiPlugin)
  .use(appPlugin)
  .listen({ hostname: envConfig.HOST, port: envConfig.PORT });

console.log(
  `Atuin Dashboard running at http://${envConfig.HOST}:${envConfig.PORT}`
);
if (envConfig.HOST !== "127.0.0.1" && envConfig.HOST !== "localhost") {
  console.warn(
    `⚠️  Listening on ${envConfig.HOST}: every endpoint is unauthenticated and can ` +
      `delete history on every synced machine. Put authentication in front of it.`
  );
}

export type App = typeof app;
