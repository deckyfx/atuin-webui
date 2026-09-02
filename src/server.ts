import { Elysia } from "elysia";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { envConfig } from "./env-config";
import { Migrator } from "./db/migrator";

// Bring the dashboard's own database up to date before serving.
await Migrator.run();

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
