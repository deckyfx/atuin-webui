/**
 * Visualization tokens.
 *
 * These resolve through CSS custom properties rather than literal hex, so the
 * charts follow the theme switcher. Both light and dark steps are validated as
 * sets against their own surface -- see styles.css for the measured figures.
 *
 * SVG presentation attributes do not accept var(), so consumers must apply
 * these through `style`, not `fill="..."`.
 */
export const SERIES = [
  "var(--c-series-1)",
  "var(--c-series-2)",
  "var(--c-series-3)",
] as const;

/** Single hue for magnitude-only charts (one series needs no legend). */
export const ACCENT = "var(--c-series-1)";

/** Recessive grid ink. */
export const GRID = "var(--c-grid)";

/** Assigns a stable colour per entity, so filtering never repaints survivors. */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length] ?? ACCENT;
}
