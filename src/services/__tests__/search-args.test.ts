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
