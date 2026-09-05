import { test, expect, describe } from "bun:test";
import { redactCommand, redactValues } from "../audit-store";

/**
 * The audit log is durable, so anything these miss is a secret this project
 * copied out of shell history and kept. The quoted cases matter most: a
 * pattern that stops at the first space leaves the tail of a passphrase behind.
 */
describe("redactCommand", () => {
  test("redacts an unquoted flag value and keeps the rest", () => {
    const out = redactCommand("mysql -u root -pSuperSecret123 db");
    expect(out).not.toContain("SuperSecret123");
    // The audit entry has to stay useful: over-redaction that eats the command
    // is its own failure, just a quieter one.
    expect(out).toContain("mysql");
    expect(out).toContain("-u root");
    expect(out).toContain("db");
  });

  test("redacts a double-quoted value containing spaces", () => {
    const out = redactCommand('deploy --password "correct horse battery staple"');
    expect(out).not.toContain("horse");
    expect(out).not.toContain("staple");
  });

  test("redacts a single-quoted value containing spaces", () => {
    const out = redactCommand("deploy --token 'a b c d'");
    expect(out).not.toContain("a b c");
  });

  test("redacts an environment assignment and keeps the name", () => {
    const out = redactCommand("export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
    expect(out).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
    // Which variable was set is the useful half; only its value is sensitive.
    expect(out).toContain("AWS_SECRET_ACCESS_KEY=");
    expect(out).toContain("export");
  });

  test("redacts a quoted environment assignment", () => {
    const out = redactCommand('API_KEY="two words here" ./deploy.sh');
    expect(out).not.toContain("two words here");
  });

  test("redacts a bearer token inside a quoted header", () => {
    const out = redactCommand('curl -H "Authorization: Bearer abc.def.ghi" https://x');
    expect(out).not.toContain("abc.def.ghi");
    // The surrounding command must survive, or the log stops being useful.
    expect(out).toContain("curl");
    expect(out).toContain("https://x");
  });

  test("redacts a long hex key", () => {
    const key = "a".repeat(48);
    expect(redactCommand(`sign --key ${key}`)).not.toContain(key);
  });

  test("leaves ordinary commands untouched", () => {
    const cmd = "git commit -m 'fix the parser'";
    expect(redactCommand(cmd)).toBe(cmd);
  });

  test("redacts a detached -p value, accepting port mappings as collateral", () => {
    // `-p secret` and `-p 8080:80` are syntactically identical, so covering the
    // password form necessarily catches the port form. Losing a port number
    // from an audit entry is the cheaper of the two mistakes.
    expect(redactCommand("mysql -p SPACED")).not.toContain("SPACED");
    expect(redactCommand("docker run -p 8080:80 img")).not.toContain("8080");
    // The rest of the command survives.
    expect(redactCommand("docker run -p 8080:80 img")).toContain("img");
  });

  test("redacts an attached -p password", () => {
    expect(redactCommand("mysql -pHUNTER2")).not.toContain("HUNTER2");
  });
});

describe("redaction covers every persisted audit field", () => {
  test("a rule object is redacted through the real serialisation path", () => {
    // Exercises redactValues + JSON.stringify as the store does, rather than
    // running the patterns over already-serialised text — the two differ, and
    // the serialised form is where escaping can defeat a match.
    const stored = JSON.stringify(
      redactValues({ query: "--password hunter2", searchMode: "prefix", limit: 10 })
    );
    expect(stored).not.toContain("hunter2");
    expect(stored).toContain("prefix");
    expect(stored).toContain("10");
  });

  test("nested and array values are redacted too", () => {
    const stored = JSON.stringify(
      redactValues({ verbs: ["ls", "--token abc123def456"], nested: { k: "-pSecret" } })
    );
    expect(stored).not.toContain("abc123def456");
    expect(stored).not.toContain("Secret");
    expect(stored).toContain("ls");
  });

  test("CLI output echoing a command is redacted", () => {
    const out = 'deleting: curl -H "Authorization: Bearer abc.def.ghi"';
    expect(redactCommand(out)).not.toContain("abc.def.ghi");
  });
});

describe("secret shapes", () => {

  test("redacts a value with backslash-escaped whitespace", () => {
  const out = redactCommand("login --password correct\\ horse\\ battery");
  expect(out).not.toContain("horse");
  expect(out).not.toContain("battery");
  });

  test("does not fire on -p inside a word", () => {
  const cmd = "./scripts/dump-pending.sh";
  expect(redactCommand(cmd)).toBe(cmd);
  });

  test("redacts lowercase inline assignments", () => {
  expect(redactCommand("curl 'https://x?token=abc123secret'")).not.toContain("abc123secret");
  expect(redactCommand("api_key=lowercase_secret ./run")).not.toContain("lowercase_secret");
  });

  test("redacts a quoted value containing an escaped quote", () => {
  const out = redactCommand('login --password "a\\"b secret tail"');
  expect(out).not.toContain("secret tail");
  expect(out).not.toContain('b secret');
  });

  test("an Authorization header does not swallow the rest of the command", () => {
  const out = redactCommand("curl -H Authorization: Bearer abc123 https://example.test/x");
  expect(out).not.toContain("abc123");
  // The bound matters: an unbounded match ran to end-of-line and ate the URL.
  expect(out).toContain("https://example.test/x");
  });

  test("ordinary author fields are not mistaken for credentials", () => {
  // "auth" as a substring redacted these, which loses useful audit detail.
  expect(redactCommand("git log --author=jane")).toContain("jane");
  expect(redactCommand("curl 'https://x?author_id=7'")).toContain("author_id=7");
  // The genuine ones still go.
  expect(redactCommand("AUTH_TOKEN=abc123 ./run")).not.toContain("abc123");
  });

  test("redacts a value separated by multiple spaces", () => {
  // A single-character separator class matched only one space, so aligned or
  // pasted commands kept their secrets.
  expect(redactCommand("login --password   hunter2")).not.toContain("hunter2");
  expect(redactCommand("deploy --token\t\tabc123")).not.toContain("abc123");
  });

  test("XDG derivation refuses a data dir that would split reads from writes", async () => {
  // atuin derives its data dir as XDG_DATA_HOME/atuin, so a client dir with a
  // different last segment makes the CLI write somewhere the dashboard is not
  // reading. Guarded rather than silently divergent.
  const prev = Bun.env.ATUIN_CLIENT_DATA_DIR;
  Bun.env.ATUIN_CLIENT_DATA_DIR = "/custom/path";
  try {
    const { envConfig } = await import("../../env-config");
    expect(() => envConfig.XDG_DATA_HOME).toThrow(/must end in "atuin"/);
  } finally {
    if (prev === undefined) delete Bun.env.ATUIN_CLIENT_DATA_DIR;
    else Bun.env.ATUIN_CLIENT_DATA_DIR = prev;
  }
  });
});

describe("credential headers", () => {
  const cases = [
    `curl -H 'X-API-Key: "secret123"' https://x`,
    `curl -H 'Authorization: Bearer "tok456"' https://x`,
    `curl -H 'Authorization: Basic "YWJj"' https://x`,
    `curl -H 'X-API-Key: plain789' https://x`,
    `curl -H "Authorization: Bearer abc.def" https://x`,
  ];

  test("quoted and unquoted values are both redacted", () => {
    for (const c of cases) {
      const out = redactCommand(c);
      for (const secret of ["secret123", "tok456", "YWJj", "plain789", "abc.def"]) {
        if (c.includes(secret)) expect(out).not.toContain(secret);
      }
    }
  });

  test("the surrounding command survives", () => {
    // An unquoted value that swallowed the closing quote took the URL with it.
    for (const c of cases) {
      const out = redactCommand(c);
      expect(out).toContain("https://x");
      expect(out).toContain("curl");
    }
  });
});
