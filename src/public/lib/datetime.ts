/**
 * Timestamp rendering.
 *
 * The two databases this dashboard reads do not agree on a zone, so the
 * conversion cannot be shared blindly:
 *
 * - the dashboard's own `prune_audit.created_at` is UTC (`datetime('now')`)
 * - atuin's `users.created_at` is local (`datetime('now','localtime')`)
 *
 * Treating the second as UTC shifts every value by the server's offset — seven
 * hours on the machine this was found on. Each caller states which it has.
 */

/** Parses a "YYYY-MM-DD HH:MM:SS" string, returning null when malformed. */
function parse(value: string, asUtc: boolean): Date | null {
  const iso = value.trim().replace(" ", "T");
  const d = new Date(asUtc ? `${iso}Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Renders a UTC timestamp in the viewer's zone. */
export function formatUtc(value: string): string {
  return parse(value, true)?.toLocaleString() ?? value;
}

/**
 * Renders a timestamp already written in the *server's* local zone.
 *
 * Parsed without a zone suffix, so it is interpreted in the viewer's zone.
 * That is exact when viewer and server share a zone and approximate otherwise
 * — the stored value simply does not record which offset produced it.
 */
export function formatServerLocal(value: string): string {
  return parse(value, false)?.toLocaleString() ?? value;
}
