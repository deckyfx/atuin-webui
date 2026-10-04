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
    // toContain already proves presence; the index assertion is about order.
    expect(args).toContain("--cmd-only");
    expect(args.indexOf("--cmd-only")).toBeLessThan(args.length - 1);
  });

  test("preview and delete select the same entries", () => {
    // Built from the flags the callers actually pass, so the test breaks if
    // either side changes its selection arguments — which is the property the
    // confirm step depends on. Output-shape flags are the only difference.
    const previewFlags = ["--cmd-only", "--print0", "--include-duplicates"];
    const deleteFlags = ["--delete", "--include-duplicates"];
    const outputOnly = new Set(["--cmd-only", "--print0", "--delete"]);

    const selection = (extra: string[]) =>
      AtuinCli.searchArgs(rule, extra).filter((a) => !outputOnly.has(a));

    expect(selection(previewFlags)).toEqual(selection(deleteFlags));
    // And both must still carry --include-duplicates, or the counts diverge.
    expect(AtuinCli.searchArgs(rule, previewFlags)).toContain("--include-duplicates");
    expect(AtuinCli.searchArgs(rule, deleteFlags)).toContain("--include-duplicates");
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

describe("a non-zero exit is not a timeout", () => {
  test("a query that matches nothing reports zero, not a failure", async () => {
    // `proc.killed` is true for any exited process in Bun, so testing it
    // reported atuin's ordinary exit-1 ("matched nothing") as a 120s timeout —
    // returned in 21ms — and put that text in stderr, which defeated the
    // empty-stderr test that tells "no matches" apart from a real failure.
    const result = await AtuinCli.previewDelete({
      query: "zzzz-definitely-not-a-command-zzzz",
      searchMode: "prefix",
      filterMode: "global",
    });
    expect(result.total).toBe(0);
    expect(result.unique).toBe(0);
  });
});

describe("dedup adapts to the installed atuin", () => {
  test("the argument shape matches what this binary accepts", async () => {
    // 18.23 made --before and --dupkeep mandatory; 18.20 rejects them. The
    // probe reads --help rather than parsing a version, so a dedup built here
    // must be runnable by whichever binary is actually present.
    const help = await AtuinCli.run0(["history", "dedup", "--help"]);
    const needsFlags = help.includes("--dupkeep");
    const args = await AtuinCli.dedupArgs0();
    expect(args.includes("--dupkeep")).toBe(needsFlags);
    expect(args.includes("--before")).toBe(needsFlags);
    // Either way it is still the dedup subcommand.
    expect(args.slice(0, 2)).toEqual(["history", "dedup"]);
  });
});
