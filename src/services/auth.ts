import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envConfig } from "../env-config";

/**
 * Access token for the dashboard API.
 *
 * Loopback is not an authorisation boundary: every local account on the
 * machine can reach 127.0.0.1. Without a credential, any other user — or any
 * process running as them — can read command history containing tokens and
 * delete history across every synced machine.
 *
 * The token lives in a 0600 file, so possession of it is equivalent to being
 * the user who owns the dashboard's config directory. That is the property
 * loopback was incorrectly assumed to provide.
 */
const COOKIE = "atuin_dashboard_session";

let cached: string | null = null;

/** Path of the token file. */
export function tokenPath(): string {
  return join(envConfig.RUNTIME_CONFIG_DIR, "api-token");
}

/** Reads the token, creating one on first run. */
export function apiToken(): string {
  if (cached) return cached;

  const path = tokenPath();
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) {
      cached = existing;
      return cached;
    }
  } catch {
    // Absent: fall through and create one.
  }

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  mkdirSync(envConfig.RUNTIME_CONFIG_DIR, { recursive: true });
  // Written then tightened, and the mode is set explicitly rather than relying
  // on umask, which varies by system.
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  cached = token;
  return token;
}

/** Constant-time comparison, so a wrong token cannot be found byte by byte. */
function matches(candidate: string): boolean {
  const expected = apiToken();
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Whether a request carries the token.
 *
 * Three ways in, in order of how a caller is most likely to have it:
 * the session cookie the app sets, an explicit header for scripts, and the
 * `?token=` query used once to establish the cookie.
 */
export function isAuthorised(request: Request): boolean {
  const header = request.headers.get("x-dashboard-token");
  if (header && matches(header.trim())) return true;

  const url = new URL(request.url);
  const query = url.searchParams.get("token");
  if (query && matches(query.trim())) return true;

  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE && matches(rest.join("=").trim())) return true;
  }
  return false;
}

/** The Set-Cookie value that turns a `?token=` visit into a session. */
export function sessionCookie(): string {
  // HttpOnly so page scripts cannot read it; SameSite=Strict so another site
  // cannot make authenticated requests on the user's behalf.
  return `${COOKIE}=${apiToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`;
}

/** The URL to open, including the token, for printing at startup. */
export function startupUrl(): string {
  const host = envConfig.IS_LOOPBACK_HOST ? "127.0.0.1" : envConfig.HOST;
  // /auth rather than /: the shell route must stay a bare HTML module, and
  // this path exists purely to turn the token into a cookie.
  return `http://${host}:${envConfig.PORT}/auth?token=${apiToken()}`;
}
