import { test, expect, describe } from "bun:test";
import { formatUtc, formatServerLocal } from "../datetime";

describe("timestamp contracts", () => {
  test("UTC and server-local readings of the same text differ", () => {
    // The bug this guards: rendering atuin's localtime column through the UTC
    // path shifted every value by the server's offset.
    const stamp = "2026-05-27 08:04:04";
    if (new Date().getTimezoneOffset() !== 0) {
      expect(formatUtc(stamp)).not.toBe(formatServerLocal(stamp));
    }
  });

  test("malformed input is returned unchanged, not 'Invalid Date'", () => {
    expect(formatUtc("not a date")).toBe("not a date");
    expect(formatServerLocal("")).toBe("");
  });

  test("formatUtc reads the value as UTC", () => {
    expect(formatUtc("2026-01-01 00:00:00")).toBe(
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toLocaleString()
    );
  });
});
