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

/** "YYYY-MM-DD HH:MM:SS", optionally with fractional seconds. */
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

/**
 * Parses a "YYYY-MM-DD HH:MM:SS" string, returning null when malformed.
 *
 * The calendar is checked against the parsed value rather than trusting
 * `new Date`, which silently rolls "2026-02-30" forward to March 2. Without
 * this, a corrupt row renders as a plausible but wrong date instead of
 * falling back to its raw text.
 */
function parse(value: string, asUtc: boolean): Date | null {
  const m = STAMP.exec(value.trim());
  if (!m) return null;

  const [, y, mo, day, h, min, sec] = m.map(Number) as unknown as number[];
  if (
    y === undefined || mo === undefined || day === undefined ||
    h === undefined || min === undefined || sec === undefined
  ) {
    return null;
  }
  if (mo < 1 || mo > 12 || day < 1 || h > 23 || min > 59 || sec > 59) return null;

  const iso = value.trim().replace(" ", "T");
  const d = new Date(asUtc ? `${iso}Z` : iso);
  if (Number.isNaN(d.getTime())) return null;

  // Round-trip check: a rolled-over date no longer reports the day it was given.
  const gotDay = asUtc ? d.getUTCDate() : d.getDate();
  const gotMonth = (asUtc ? d.getUTCMonth() : d.getMonth()) + 1;
  return gotDay === day && gotMonth === mo ? d : null;
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
