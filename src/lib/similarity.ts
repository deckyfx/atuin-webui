/**
 * Near-duplicate detection for shell history.
 *
 * Why not a string-distance library: the obvious choice is Levenshtein, and
 * every maintained package implements it, but it is O(len²) per comparison and
 * these commands have a median length of 250 characters and a p95 of 2,588 —
 * one 24,000-character heredoc among them. Comparing even a blocked subset
 * that way is minutes of work.
 *
 * Trigram Jaccard instead: each command is shingled once, and a comparison is
 * then a set intersection proportional to the smaller set. Measured on a real
 * 16,728-command history, the whole pass takes about 1.5s.
 */

/** Longest prefix that is shingled. */
const SHINGLE_CAP = 512;
const SHINGLE_SIZE = 3;

/** Case and whitespace folded; this alone finds almost nothing, which is why
 *  the similarity pass exists at all. */
export function normalise(command: string): string {
  return command.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Character trigrams of the normalised prefix. */
export function shingle(command: string): Set<string> {
  const s = normalise(command).slice(0, SHINGLE_CAP);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= s.length; i++) {
    out.add(s.slice(i, i + SHINGLE_SIZE));
  }
  return out;
}

/** Intersection over union, 0–1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const gram of small) if (big.has(gram)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Blocking key: first token plus a coarse length bucket.
 *
 * Commands that differ in either are never similar enough to matter, and this
 * turns 139.9M candidate pairs into roughly 615K — the difference between
 * infeasible and about a second.
 */
export function blockKey(command: string): string {
  const s = normalise(command);
  const head = s.slice(0, s.indexOf(" ") === -1 ? s.length : s.indexOf(" "));
  return `${head}|${Math.floor(s.length / 40)}`;
}

export interface Cluster {
  /** The command kept — the first seen in the block. */
  keep: string;
  /** The near-duplicates that would be removed. */
  remove: string[];
  /** Lowest similarity between `keep` and any member, for display. */
  worst: number;
}

/**
 * Groups near-duplicates at `threshold` (0–1).
 *
 * Greedy single-pass clustering: the first unclaimed command in a block
 * becomes the representative and absorbs anything similar enough. Not optimal
 * clustering, but the alternative needs the full pairwise matrix, and for
 * "which of these are the same command typed twice" the difference does not
 * show.
 */
export function clusterNearDuplicates(commands: string[], threshold: number): Cluster[] {
  const sets = commands.map(shingle);
  const blocks = new Map<string, number[]>();
  commands.forEach((c, i) => {
    const key = blockKey(c);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(i);
    else blocks.set(key, [i]);
  });

  const claimed = new Set<number>();
  const clusters: Cluster[] = [];

  for (const indices of blocks.values()) {
    for (let a = 0; a < indices.length; a++) {
      const i = indices[a]!;
      if (claimed.has(i)) continue;

      const remove: string[] = [];
      let worst = 1;
      for (let b = a + 1; b < indices.length; b++) {
        const j = indices[b]!;
        if (claimed.has(j)) continue;
        const score = jaccard(sets[i]!, sets[j]!);
        if (score >= threshold) {
          claimed.add(j);
          remove.push(commands[j]!);
          if (score < worst) worst = score;
        }
      }
      if (remove.length > 0) clusters.push({ keep: commands[i]!, remove, worst });
    }
  }

  return clusters;
}
