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
  .listen(envConfig.PORT);

console.log(`Atuin Dashboard running at http://localhost:${envConfig.PORT}`);

export type App = typeof app;
