import { Elysia } from "elysia";
import index from "../public/index.html";
import { isAuthorised, sessionCookie } from "../services/auth";

/**
 * Serves the single-page app.
 *
 * The shell is not gated: it is bundled JS and CSS with no user data, and
 * everything that matters comes from /api, which requires the token. It also
 * cannot be gated from here — a Bun HTML module only serves correctly when it
 * is the handler itself; returning it from a function produces an empty JSON
 * body instead of the document.
 *
 * `/auth?token=…` is a separate route for the same reason: it exchanges the
 * token for a session cookie and redirects to `/`, so the token leaves the
 * address bar, browser history and any Referer header after one use.
 */
export const appPlugin = new Elysia()
  .get("/auth", ({ request, set }) => {
    if (!isAuthorised(request)) {
      set.status = 401;
      return { message: "Invalid or missing token." };
    }
    set.headers["set-cookie"] = sessionCookie();
    set.status = 302;
    set.headers["location"] = "/";
    return "";
  })
  .get("/", index)
  .get("/*", index);
