import { treaty } from "@elysiajs/eden";
import type { App } from "../../server";

export const api = treaty<App>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"
);
