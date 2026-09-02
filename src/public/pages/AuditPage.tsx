import React, { useEffect, useState } from "react";
import { ScrollText, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { Card, Skeleton } from "../components/Card";
import { getJson, errorMessage, isArray } from "../lib/http";

interface AuditRow {
  id: number;
  action: string;
  profile: string;
  rule: string | null;
  matchedCount: number;
  sample: string | null;
  status: "pending" | "succeeded" | "failed";
  output: string | null;
  createdAt: string;
}

/**
 * Record of the dashboard's destructive actions.
 *
 * Deletions propagate to every synced machine and cannot be undone here, so
 * this is the only surviving trace of what a prune removed.
 */
/** Rows are stored UTC; show them where the reader is. */
function formatDate(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    // Distinguished from an empty log: presenting a failed fetch as "no
    // destructive actions recorded" is the opposite of what happened.
    getJson<AuditRow[]>("/api/audit", { expect: isArray })
      .then(setRows)
      .catch((err) => setError(errorMessage(err, "Failed to load.")));
  }, []);

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <ScrollText size={22} className="text-ink-muted" />
          Audit Log
        </h1>
        <p className="text-ink-muted text-sm mt-1">
          Every batch mutation, captured before it ran.
        </p>
      </header>

      {error && (
        <p className="text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-3">
          Could not load the audit log: {error}
        </p>
      )}

      {rows === null && !error && <Skeleton height={200} />}

      {rows?.length === 0 && (
        <Card title="Nothing yet" sub="Batch operations will appear here">
          <p className="text-ink-subtle text-sm">
            Run a prune or dedup and it will be recorded.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {rows?.map((row) => {
          // Guarded: one malformed row would otherwise throw during render
          // and blank the entire log.
          let sample: string[] = [];
          try {
            if (row.sample) sample = JSON.parse(row.sample) as string[];
          } catch {
            sample = [];
          }
          const isOpen = open === row.id;
          return (
            <div key={row.id} className="rounded-xl border border-line bg-raised">
              <button
                onClick={() => setOpen(isOpen ? null : row.id)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {row.status === "succeeded" ? (
                  <CheckCircle2 size={16} className="text-brand shrink-0" />
                ) : row.status === "failed" ? (
                  <XCircle size={16} className="text-danger shrink-0" />
                ) : (
                  // Outcome never recorded — distinct from a known failure.
                  <span title="Outcome unknown — the operation ran but its result was never recorded">
                    <HelpCircle size={16} className="text-warn shrink-0" aria-label="Outcome unknown" />
                  </span>
                )}
                <span className="font-medium text-sm text-ink">{row.action}</span>
                <span className="text-xs text-ink-subtle font-mono">{row.profile}</span>
                <span className="flex-1" />
                {row.matchedCount > 0 && (
                  <span className="text-xs text-ink-muted tabular-nums">
                    {row.matchedCount.toLocaleString()} matched
                  </span>
                )}
                <span className="text-xs text-ink-subtle">{formatDate(row.createdAt)}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
                  {row.rule && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-ink-subtle mb-1">
                        Rule
                      </p>
                      <code className="text-xs font-mono text-ink-muted break-all">
                        {row.rule}
                      </code>
                    </div>
                  )}
                  {sample.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-ink-subtle mb-1">
                        Removed ({sample.length} shown)
                      </p>
                      <div className="max-h-48 overflow-y-auto rounded-lg bg-surface border border-line p-2.5">
                        {sample.map((cmd, i) => (
                          <code
                            key={i}
                            className="block text-xs font-mono text-ink-muted truncate"
                          >
                            {cmd}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  {row.output && (
                    <pre className="text-xs text-ink-subtle whitespace-pre-wrap">
                      {row.output}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
