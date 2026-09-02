import { Elysia } from "elysia";
import index from "../public/index.html";

export const appPlugin = new Elysia()
  .get("/", index)
  .get("/*", index);
