import React from "react";
import type { LucideIcon } from "lucide-react";

/** Semantic tone, not a colour name: the palette differs per theme. */
export type StatTone = "default" | "brand" | "warn" | "danger";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  tone?: StatTone;
  icon?: LucideIcon;
}

const toneMap: Record<StatTone, string> = {
  default: "bg-raised border-line text-ink",
  brand: "bg-brand-soft border-brand/20 text-brand",
  warn: "bg-warn-soft border-warn/20 text-warn",
  danger: "bg-danger-soft border-danger/20 text-danger",
};

/** A single headline number. No plot, so no hover layer. */
export function StatCard({ label, value, sub, tone = "default", icon: Icon }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${toneMap[tone]}`}>
      {/* No opacity on the small text. At 12px the contrast floor is 4.5:1,
          and 60-70% opacity over a tinted card can fall under it; the label is
          already distinguished by size, weight and caps. */}
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon size={13} />}
        <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  );
}
