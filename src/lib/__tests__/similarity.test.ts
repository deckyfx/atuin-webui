import { test, expect, describe } from "bun:test";
import { jaccard, shingle, blockKey, clusterNearDuplicates, normalise } from "../similarity";

describe("similarity", () => {
  test("identical commands score 1", () => {
    expect(jaccard(shingle("git status"), shingle("git status"))).toBe(1);
  });

  test("case and whitespace do not affect the score", () => {
    expect(jaccard(shingle("GIT   status"), shingle("git status"))).toBe(1);
    expect(normalise("  Git\tSTATUS ")).toBe("git status");
  });

  test("unrelated commands score low", () => {
    expect(jaccard(shingle("git status"), shingle("docker compose up"))).toBeLessThan(0.2);
  });

  test("a changed argument scores high but below 1", () => {
    const s = jaccard(
      shingle("./bin/sync-run wiwid --no-clean"),
      shingle("./bin/sync-run kdsmalang --no-clean")
    );
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });

  test("blocking separates different commands and different lengths", () => {
    expect(blockKey("git status")).not.toBe(blockKey("docker ps"));
    expect(blockKey("git status")).not.toBe(blockKey(`git ${"x".repeat(120)}`));
  });

  test("clustering keeps one and removes the rest", () => {
    const cmds = ["npm run build", "npm run build ", "npm  run  build", "docker ps"];
    const clusters = clusterNearDuplicates(cmds, 0.9);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.remove).toHaveLength(2);
    // The survivor is never also in the removal list — that would delete
    // every copy of a command the user asked to keep one of.
    expect(clusters[0]!.remove).not.toContain(clusters[0]!.keep);
  });

  test("a higher threshold clusters no more than a lower one", () => {
    const cmds = ["deploy --env prod", "deploy --env prd", "deploy --env dev", "ls"];
    const loose = clusterNearDuplicates(cmds, 0.6).reduce((n, c) => n + c.remove.length, 0);
    const tight = clusterNearDuplicates(cmds, 0.95).reduce((n, c) => n + c.remove.length, 0);
    expect(tight).toBeLessThanOrEqual(loose);
  });

  test("an empty history clusters to nothing", () => {
    expect(clusterNearDuplicates([], 0.8)).toEqual([]);
  });
});
