import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  email: text("email").notNull(),
  password: text("password").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now','localtime'))`),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  token: text("token").notNull(),
});

export const history = sqliteTable("history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull(),
  userId: integer("user_id").notNull(),
  hostname: text("hostname").notNull(),
  timestamp: text("timestamp").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull().default(sql`current_timestamp`),
  deletedAt: text("deleted_at"),
});

export const store = sqliteTable("store", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  host: text("host").notNull(),
  idx: integer("idx").notNull(),
  timestamp: integer("timestamp").notNull(),
  version: text("version").notNull(),
  tag: text("tag").notNull(),
  data: text("data").notNull(),
  cek: text("cek").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`current_timestamp`),
});

export const storeIdxCache = sqliteTable("store_idx_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  host: text("host"),
  tag: text("tag"),
  idx: integer("idx"),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type StoreRecord = typeof store.$inferSelect;
