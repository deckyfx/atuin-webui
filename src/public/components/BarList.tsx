import React from "react";
import { ACCENT } from "./viz";

interface Item {
  label: string;
  value: number;
  color?: string;
}

interface Props {
  items: Item[];
  /** Rendered next to each value, e.g. "commands". */
  unit?: string;
  onSelect?: (label: string) => void;
}

/**
 * Ranked magnitude by category — a horizontal bar list.
 *
 * Every row is directly labelled, so identity never rests on colour and no
 * legend is needed. Bars are anchored to a common baseline for comparability.
 */
export function BarList({ items, unit, onSelect }: Props) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const pct = (item.value / max) * 100;
        const Row = onSelect ? "button" : "div";
        return (
          <Row
            key={item.label}
            {...(onSelect ? { onClick: () => onSelect(item.label), type: "button" as const } : {})}
            className={`w-full flex items-center gap-3 group text-left ${
              onSelect ? "cursor-pointer" : ""
            }`}
          >
            <span className="w-40 shrink-0 truncate font-mono text-xs text-ink-muted" title={item.label}>
              {item.label || "(blank)"}
            </span>
            <span className="flex-1 h-2.5 rounded-sm bg-hover overflow-hidden">
              <span
                className="block h-full rounded-sm motion-safe:transition-[width] motion-safe:duration-500"
                style={{
                  // Floor the width so a non-zero value is never invisible
                  // next to a dominant one (2 vs 15,000).
                  width: `${item.value > 0 ? Math.max(pct, 1.5) : 0}%`,
                  backgroundColor: item.color ?? ACCENT,
                  opacity: onSelect ? undefined : 1,
                }}
              />
            </span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-muted">
              {item.value.toLocaleString()}
              {unit && <span className="text-ink-subtle ml-1">{unit}</span>}
            </span>
          </Row>
        );
      })}
    </div>
  );
}
