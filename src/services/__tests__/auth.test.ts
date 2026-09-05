import { test, expect, describe, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Loopback is not an authorisation boundary, so these assertions are the thing
 * standing between another local account and the history-deletion endpoints.
 */
describe("api token", () => {
  let auth: typeof import("../auth");

  beforeAll(async () => {
    Bun.env.DASHBOARD_CONFIG_DIR = mkdtempSync(join(tmpdir(), "auth-test-"));
    auth = await import("../auth");
  });

  const req = (headers: Record<string, string>, url = "http://127.0.0.1:3001/api/x") =>
    new Request(url, { headers });

  test("a request with no credential is rejected", () => {
    expect(auth.isAuthorised(req({}))).toBe(false);
  });

  test("a wrong token is rejected", () => {
    expect(auth.isAuthorised(req({ "x-dashboard-token": "wrong" }))).toBe(false);
  });

  test("a token of the right length but wrong content is rejected", () => {
    // Guards the constant-time comparison: equal lengths must still fail.
    const wrong = "0".repeat(auth.apiToken().length);
    expect(auth.isAuthorised(req({ "x-dashboard-token": wrong }))).toBe(false);
  });

  test("the header, the cookie and the query all work", () => {
    const token = auth.apiToken();
    expect(auth.isAuthorised(req({ "x-dashboard-token": token }))).toBe(true);
    expect(auth.isAuthorised(req({ cookie: `atuin_dashboard_session=${token}` }))).toBe(true);
    expect(auth.isAuthorised(req({}, `http://127.0.0.1:3001/auth?token=${token}`))).toBe(true);
  });

  test("another cookie of the same name-prefix does not pass", () => {
    expect(auth.isAuthorised(req({ cookie: "atuin_dashboard_session_x=zzz" }))).toBe(false);
  });

  test("the session cookie is HttpOnly and SameSite=Strict", () => {
    const c = auth.sessionCookie();
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
  });
});
