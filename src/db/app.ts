import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { envConfig } from "../env-config";
import * as appSchema from "./app-schema";

// The dashboard owns this file outright, unlike atuin's databases.
mkdirSync(dirname(envConfig.APP_DB_PATH), { recursive: true });

const sqlite = new Database(envConfig.APP_DB_PATH, { create: true });
sqlite.run("PRAGMA journal_mode=WAL;");
sqlite.run("PRAGMA busy_timeout=5000;");

export const appDb = drizzle(sqlite, { schema: appSchema });
