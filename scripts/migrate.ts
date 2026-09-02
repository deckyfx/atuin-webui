/** Applies pending migrations to the dashboard database, outside the server. */
import { Migrator } from "../src/db/migrator";

await Migrator.run();
console.log("✅ Dashboard database is up to date.");
