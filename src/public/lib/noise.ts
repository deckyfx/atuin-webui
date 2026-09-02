/**
 * Commands that are navigation rather than work.
 *
 * Shared so the Overview's "navigation noise" percentage and the Prune page's
 * "select navigation noise" shortcut always agree — two copies drifted apart
 * silently, and the stat then advertised a purge that did not match it.
 */
export const NOISE_VERBS: readonly string[] = [
  "cd",
  "ls",
  "ll",
  "cat",
  "clear",
  "pwd",
  "exit",
];
