import { test, expect, describe } from "bun:test";
import { AtuinCli } from "../atuin-cli";

/**
 * `atuin search` with no positional argument matches the entire history, so an
 * empty query must fail loudly rather than silently widening the rule.
 */
describe("empty queries are refused", () => {
  const empty = { query: "", searchMode: "prefix" as const, filterMode: "global" as const };

  test("previewDelete refuses", async () => {
    await expect(AtuinCli.previewDelete(empty)).rejects.toThrow(/empty query/i);
  });

  test("deleteMatching refuses", async () => {
    await expect(AtuinCli.deleteMatching(empty)).rejects.toThrow(/empty query/i);
  });

  test("previewVerb refuses a blank verb", async () => {
    // `verb + " "` is non-empty, so the query check alone would let a blank
    // verb through as a "commands starting with a space" rule.
    await expect(AtuinCli.previewVerb("")).rejects.toThrow(/empty query/i);
    await expect(AtuinCli.previewVerb("   ")).rejects.toThrow(/empty query/i);
  });

  test("deleteVerb refuses a blank verb", async () => {
    await expect(AtuinCli.deleteVerb(" ")).rejects.toThrow(/empty query/i);
  });
});

describe("searchArgs builds the query the caller asked for", () => {
  const rule = { query: "git ", searchMode: "prefix" as const, filterMode: "global" as const };

  test("the positional query is last, after every flag", () => {
    const args = AtuinCli.searchArgs(rule, ["--cmd-only", "--print0"]);
    expect(args[args.length - 1]).toBe("git ");
    // atuin rejects flags that follow the positional, which is how an earlier
    // version of this silently failed every invocation.
    // Present *and* before the positional: asserting only the index would
    // pass vacuously if the flag were dropped entirely (indexOf → -1).
    expect(args).toContain("--cmd-only");
    expect(args.indexOf("--cmd-only")).toBeGreaterThanOrEqual(0);
    expect(args.indexOf("--cmd-only")).toBeLessThan(args.length - 1);
  });

  test("preview and delete differ only by their extra flags", () => {
    const preview = AtuinCli.searchArgs(rule, ["--cmd-only", "--print0", "--include-duplicates"]);
    const del = AtuinCli.searchArgs(rule, ["--delete", "--include-duplicates"]);
    const strip = (a: string[]) => a.filter((x) => !x.startsWith("--cmd-only") && !x.startsWith("--print0") && x !== "--delete");
    // The confirm step rests on these describing the same set of entries.
    expect(strip(preview)).toEqual(strip(del));
  });

  test("an empty query throws rather than widening the rule", () => {
    expect(() => AtuinCli.searchArgs({ ...rule, query: "" }, [])).toThrow(/empty query/i);
  });

  test("filters are passed through", () => {
    const args = AtuinCli.searchArgs({ ...rule, exit: 0, before: "30 days ago" }, []);
    expect(args).toContain("--exit");
    expect(args).toContain("--before");
  });
});
