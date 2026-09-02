import React from "react";

interface Props {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Standard chart/section container. */
export function Card({ title, sub, action, children }: Props) {
  return (
    <section className="rounded-xl border border-line bg-raised p-5">
      <header className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {sub && <p className="text-xs text-ink-subtle mt-0.5">{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Loading placeholder that reserves the final layout's height. */
export function Skeleton({ height = 80 }: { height?: number }) {
  return (
    <div
      // motion-safe: a pulsing placeholder is exactly the kind of animation
      // that triggers discomfort for users who have asked for reduced motion.
      className="rounded-lg bg-hover motion-safe:animate-pulse"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
