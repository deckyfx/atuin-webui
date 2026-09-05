import { Elysia } from "elysia";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { envConfig } from "./env-config";
import { Migrator } from "./db/migrator";
import { startupUrl, tokenPath } from "./services/auth";

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

// A non-loopback bind is a decision, not a default. Every endpoint is
// unauthenticated: the API deletes history on every synced machine, accepts an
// account key, writes an executable to disk and returns command text that
// routinely contains tokens. A warning is easy to miss in a log; refusing to
// start is not. The container sets both, because loopback inside a container
// is unreachable from the host.
if (!envConfig.IS_LOOPBACK_HOST && !envConfig.ALLOW_PUBLIC_BIND) {
  console.error(
    `Refusing to listen on ${envConfig.HOST}.\n` +
      `The API is token-gated, but off-host it needs TLS in front — otherwise the ` +
      `token crosses the network in cleartext and nothing will authenticate.\n` +
      `Put a TLS-terminating proxy in front, then set ALLOW_PUBLIC_BIND=1 to confirm.`
  );
  process.exit(1);
}

const app = new Elysia()
  .use(apiPlugin)
  .use(appPlugin)
  .listen({ hostname: envConfig.HOST, port: envConfig.PORT });

// The token is in the URL because that is the only place the owning user
// reliably sees it; the visit exchanges it for a cookie and drops it.
console.log(`Atuin Dashboard running at ${startupUrl()}`);
console.log(`Token file: ${tokenPath()} (mode 0600)`);
if (!envConfig.IS_LOOPBACK_HOST) {
  console.warn(
    `⚠️  Listening on ${envConfig.HOST} with ALLOW_PUBLIC_BIND set. The API ` +
      `requires a token, and off-host it is refused unless the request arrives ` +
      `over TLS — directly or via a proxy setting X-Forwarded-Proto: https. ` +
      `Without that proxy nothing will authenticate.`
  );
}

export type App = typeof app;
