import React, { useState } from "react";
import { ACCENT, GRID } from "./viz";

interface Point {
  day: string;
  count: number;
}

interface Props {
  data: Point[];
  height?: number;
}

/**
 * Daily command volume.
 *
 * Discrete day buckets, one series, magnitude — a bar chart. No legend (the
 * title names the series); labels are selective rather than per-bar; the grid
 * is recessive; hover carries the exact values.
 */
export function ActivityChart({ data, height = 160 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-ink-subtle text-sm"
      >
        No activity in this window.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const gap = 2; // surface gap between adjacent bars
  const slot = 100 / data.length;
  const barW = Math.max(slot - (gap / 4), 0.5);
  const active = hover === null ? null : data[hover];

  // Gridlines sit at these fractions of the plot area; label them so the
  // magnitude is readable without hovering. An unlabelled gridline is chart
  // junk: it implies a scale it never states.
  const PLOT = 0.86;
  const ticks = [
    { value: max, top: (1 - PLOT) * height },
    { value: Math.round(max / 2), top: (1 - PLOT / 2) * height },
  ];

  return (
    <div className="relative pl-10">
      {ticks.map((t) => (
        <span
          key={t.value}
          className="absolute left-0 -translate-y-1/2 text-[10px] tabular-nums text-ink-subtle"
          style={{ top: t.top }}
        >
          {t.value.toLocaleString()}
        </span>
      ))}
      {/* Baseline + two recessive gridlines; no chart junk beyond that. */}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="block overflow-visible"
        role="img"
        aria-label={`Daily command volume over ${data.length} days`}
      >
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={100}
            y1={height - f * height * PLOT}
            y2={height - f * height * PLOT}
            style={{ stroke: GRID }}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {data.map((d, i) => {
          const h = Math.max((d.count / max) * height * PLOT, d.count > 0 ? 2 : 0);
          const x = i * slot;
          const isHover = hover === i;
          return (
            <g key={d.day}>
              {/* Hit target spans the full slot height, larger than the mark. */}
              <rect
                x={x}
                y={0}
                width={slot}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              <rect
                x={x}
                y={height - h}
                width={barW}
                height={h}
                rx={1.5}
                style={{ fill: ACCENT }}
                opacity={hover === null || isHover ? 1 : 0.45}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between mt-2 text-[11px] text-ink-subtle">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>

      {active && (
        <div className="absolute -top-1 left-0 right-0 flex justify-center pointer-events-none">
          <div className="rounded-md bg-hover border border-line-strong px-2.5 py-1 text-xs shadow-lg">
            <span className="text-ink font-semibold">
              {active.count.toLocaleString()}
            </span>
            <span className="text-ink-muted ml-1.5">on {active.day}</span>
          </div>
        </div>
      )}
    </div>
  );
}
