import { test, expect, describe } from "bun:test";
import { redactCommand, redactValues } from "../audit-store";

/**
 * The audit log is durable, so anything these miss is a secret this project
 * copied out of shell history and kept. The quoted cases matter most: a
 * pattern that stops at the first space leaves the tail of a passphrase behind.
 */
describe("redactCommand", () => {
  test("redacts an unquoted flag value", () => {
    expect(redactCommand("mysql -u root -pSuperSecret123 db")).not.toContain("SuperSecret123");
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

  test("redacts an environment assignment", () => {
    const out = redactCommand("export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
    expect(out).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
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

  test("leaves a detached -p argument alone", () => {
    // The attached-password rule requires no space, so `docker run -p 8080:80`
    // keeps its port mapping. Tools that take a password this way (mysql, psql)
    // attach it, which is the form that is matched.
    const cmd = "docker run -p 8080:80 img";
    expect(redactCommand(cmd)).toBe(cmd);
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
