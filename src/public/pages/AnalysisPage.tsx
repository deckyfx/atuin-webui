import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChartPie, Trash2, Eye, AlertTriangle, X, Info } from "lucide-react";
import { Card, Skeleton } from "../components/Card";
import { getJson, postJson, errorMessage, hasNumber } from "../lib/http";
import { useToastStore } from "../stores/toast-store";

interface Category {
  id: string;
  label: string;
  description: string;
  cost: string;
  count: number;
  purgeable: boolean;
  why?: string;
  mechanism: "rule" | "verbs" | "dedup" | "exact" | "none";
}

interface FuzzyResult {
  threshold: number;
  clusters: number;
  removable: number;
  sample: Array<{ keep: string; remove: string[]; worst: number }>;
}

interface Analysis {
  total: number;
  remaining: number;
  categories: Category[];
}

/** How long an exact-delete category takes, roughly, at ~2 CLI calls each. */
function estimateMinutes(distinct: number): number {
  return Math.max(1, Math.round((distinct * 2 * 0.35) / 60));
}

/**
 * What the history is made of, and what can be removed.
 *
 * Counts come from SQL because they must be exact and instant. What a purge
 * actually removes is whatever the atuin CLI matches at confirm time, and that
 * number — not the one on the card — is what the confirmation shows. The two
 * can differ: SQL sees the database, atuin applies its own matching.
 */
export function AnalysisPage() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sample, setSample] = useState<{ id: string; lines: string[] } | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; count: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const push = useToastStore((s) => s.push);
  const seq = useRef(0);

  // Near-duplicates are computed on demand: the pass is ~1.5s over the whole
  // history, which is fine for a button and wrong for a page load.
  const [threshold, setThreshold] = useState(0.9);
  const [fuzzy, setFuzzy] = useState<FuzzyResult | null>(null);
  const [fuzzyBusy, setFuzzyBusy] = useState(false);
  const [fuzzyConfirm, setFuzzyConfirm] = useState(false);
  const fuzzySeq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    getJson<Analysis>("/api/history/analysis", { expect: hasNumber("total", "remaining") })
      .then((a) => {
        if (mine !== seq.current) return;
        setAnalysis(a);
        setLoadError(null);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setLoadError(errorMessage(err, "Could not analyse the history"));
      });
  }, []);

  useEffect(load, [load]);

  async function showSample(id: string) {
    setSample(null);
    try {
      const body = await getJson<{ sample: string[] }>(`/api/history/analysis/${id}/sample`);
      setSample({ id, lines: body.sample });
    } catch (err) {
      push("error", errorMessage(err, "Could not read a sample."));
    }
  }

  /** Runs the purge the server said this category supports. */
  async function purge(c: Category) {
    setBusy(c.id);
    setProgress(null);
    try {
      let removed = 0;

      if (c.mechanism === "dedup") {
        const pre = await getJson<{ removable: number; fingerprint: string }>(
          "/api/dedup/preview",
          { expect: hasNumber("removable") }
        );
        await postJson("/api/dedup", { expectedFingerprint: pre.fingerprint });
        removed = pre.removable;
      } else if (c.mechanism === "verbs") {
        const plan = await getJson<{ purge: { verbs: string[] } }>(
          `/api/history/analysis/${c.id}/plan`
        );
        const body = await postJson<{ removed: number }>("/api/prune/execute-verbs", {
          verbs: plan.purge.verbs,
        });
        removed = body.removed ?? 0;
      } else if (c.mechanism === "rule") {
        const plan = await getJson<{ purge: { rule: unknown } }>(
          `/api/history/analysis/${c.id}/plan`
        );
        await postJson("/api/prune/execute", plan.purge.rule);
        removed = c.count;
      } else if (c.mechanism === "exact") {
        // Deleted in batches of distinct commands: atuin cannot match "is
        // multi-line", so each command goes individually.
        for (;;) {
          const batch = await getJson<{ commands: string[]; distinct: number }>(
            `/api/history/analysis/${c.id}/commands?limit=200`
          );
          if (batch.commands.length === 0) break;
          setProgress(`${removed} removed, ${batch.distinct} distinct commands left`);
          const body = await postJson<{ deleted: number }>("/api/history/delete-batch", {
            commands: batch.commands,
          });
          if (!body.deleted) break; // nothing moved; stop rather than spin
          removed += body.deleted;
        }
      }

      push("success", `Removed ${removed.toLocaleString()} from ${c.label}.`);
      setConfirming(null);
      load();
    } catch (err) {
      push("error", errorMessage(err, "Purge failed."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function scanFuzzy(t: number) {
    const mine = ++fuzzySeq.current;
    setFuzzyBusy(true);
    setFuzzyConfirm(false);
    try {
      const body = await getJson<FuzzyResult>(
        `/api/history/near-duplicates?threshold=${t}`,
        { expect: hasNumber("removable", "clusters") }
      );
      if (mine !== fuzzySeq.current) return;
      setFuzzy(body);
    } catch (err) {
      if (mine !== fuzzySeq.current) return;
      push("error", errorMessage(err, "Could not scan for near-duplicates."));
    } finally {
      if (mine === fuzzySeq.current) setFuzzyBusy(false);
    }
  }

  async function purgeFuzzy() {
    setFuzzyBusy(true);
    try {
      let removed = 0;
      for (;;) {
        const batch = await getJson<{ commands: string[] }>(
          `/api/history/near-duplicates/commands?threshold=${threshold}`
        );
        if (batch.commands.length === 0) break;
        const body = await postJson<{ deleted: number }>("/api/history/delete-batch", {
          commands: batch.commands,
        });
        if (!body.deleted) break;
        removed += body.deleted;
      }
      push("success", `Removed ${removed.toLocaleString()} near-duplicates.`);
      setFuzzy(null);
      setFuzzyConfirm(false);
      load();
    } catch (err) {
      push("error", errorMessage(err, "Purge failed."));
    } finally {
      setFuzzyBusy(false);
    }
  }

  const pct = (n: number) => (analysis?.total ? (n / analysis.total) * 100 : 0);

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <ChartPie size={22} className="text-ink-muted" />
          What the history is made of
        </h1>
        <p className="text-ink-muted text-sm mt-1">
          {analysis
            ? `${analysis.total.toLocaleString()} commands — ${analysis.remaining.toLocaleString()} of them real work.`
            : "Analysing…"}
        </p>
      </header>

      {loadError && (
        <p role="alert" className="text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-3">
          {loadError}
        </p>
      )}

      {!analysis && !loadError && <Skeleton height={320} />}

      {analysis && (
        <>
          <Card title="Composition" sub="Each command is counted once, in the order below">
            <div className="flex h-3 rounded-full overflow-hidden bg-hover mb-4">
              {analysis.categories.map((c, i) => (
                <span
                  key={c.id}
                  title={`${c.label}: ${c.count.toLocaleString()}`}
                  style={{ width: `${pct(c.count)}%`, backgroundColor: `var(--c-series-${(i % 3) + 1})` }}
                />
              ))}
              <span style={{ width: `${pct(analysis.remaining)}%` }} className="bg-brand/40" />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
              {analysis.categories.map((c, i) => (
                <span key={c.id} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: `var(--c-series-${(i % 3) + 1})` }}
                  />
                  {c.label} {pct(c.count).toFixed(1)}%
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-brand/40" />
                Real work {pct(analysis.remaining).toFixed(1)}%
              </span>
            </div>
          </Card>

          <Card
            title="Near-duplicates"
            sub="Commands that differ only slightly — a changed flag, a renamed argument"
          >
            <div className="flex items-center gap-4">
              <label htmlFor="fuzzy-threshold" className="text-xs text-ink-muted shrink-0">
                Similarity
              </label>
              <input
                id="fuzzy-threshold"
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) => {
                  setThreshold(Number(e.target.value));
                  // The old result describes a different threshold; showing it
                  // beside the new number would misstate what a purge removes.
                  setFuzzy(null);
                  setFuzzyConfirm(false);
                }}
                className="flex-1 accent-current"
              />
              <span className="w-12 text-right text-sm font-medium text-ink tabular-nums">
                {Math.round(threshold * 100)}%
              </span>
              <button
                onClick={() => void scanFuzzy(threshold)}
                disabled={fuzzyBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-hover disabled:opacity-50"
              >
                <Eye size={13} />
                {fuzzyBusy ? "Scanning…" : "Scan"}
              </button>
            </div>

            <p className="text-xs text-ink-subtle mt-2">
              100% is an exact match. Lower admits looser pairs — at 70% a changed
              hostname or flag still counts as the same command.
            </p>

            {fuzzy && (
              <div className="mt-4">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{fuzzy.removable.toLocaleString()}</span>{" "}
                  removable across {fuzzy.clusters.toLocaleString()} clusters, keeping one
                  of each.
                </p>

                {fuzzy.sample.length > 0 && (
                  <div className="mt-3 max-h-56 overflow-y-auto rounded-lg bg-surface border border-line p-2.5 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-ink-subtle">
                      Loosest matches at this threshold — the ones to check
                    </p>
                    {fuzzy.sample.map((cl, i) => (
                      <div key={i} className="text-xs">
                        <code className="block font-mono text-ink-muted truncate">
                          keep: {cl.keep.split("\n")[0]}
                        </code>
                        {cl.remove.map((r, j) => (
                          <code key={j} className="block font-mono text-ink-subtle truncate pl-4">
                            drop: {r.split("\n")[0]}{" "}
                            <span className="opacity-60">({Math.round(cl.worst * 100)}%)</span>
                          </code>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {fuzzy.removable > 0 &&
                  (fuzzyConfirm ? (
                    <div className="mt-3 rounded-lg border border-danger/40 bg-danger-soft p-3">
                      <p className="text-xs text-danger inline-flex items-center gap-1.5">
                        <AlertTriangle size={13} />
                        Removes {fuzzy.removable.toLocaleString()} commands on every synced
                        machine. There is no undo.
                      </p>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => void purgeFuzzy()}
                          disabled={fuzzyBusy}
                          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
                        >
                          {fuzzyBusy ? "Removing…" : "Yes, purge"}
                        </button>
                        <button
                          onClick={() => setFuzzyConfirm(false)}
                          disabled={fuzzyBusy}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                        >
                          <X size={13} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setFuzzyConfirm(true)}
                      disabled={fuzzyBusy}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger disabled:opacity-50 hover:brightness-110"
                    >
                      <Trash2 size={13} />
                      Purge {fuzzy.removable.toLocaleString()}…
                    </button>
                  ))}
              </div>
            )}
          </Card>

          {analysis.categories.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-raised p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">
                    {c.label}{" "}
                    <span className="text-ink-subtle font-normal">
                      — {c.count.toLocaleString()} ({pct(c.count).toFixed(1)}%)
                    </span>
                  </h2>
                  <p className="text-xs text-ink-muted mt-1">{c.description}</p>
                  <p className="text-xs text-ink-subtle mt-1.5">
                    <span className="font-medium">What you lose:</span> {c.cost}
                  </p>
                  {c.mechanism === "exact" && (
                    <p className="text-xs text-warn mt-1.5 inline-flex items-start gap-1.5">
                      <Info size={13} className="shrink-0 mt-0.5" />
                      Removed one command at a time — atuin cannot match this as a
                      search. Roughly {estimateMinutes(c.count)} min.
                    </p>
                  )}
                  {!c.purgeable && c.why && (
                    <p className="text-xs text-ink-subtle mt-1.5 inline-flex items-start gap-1.5">
                      <Info size={13} className="shrink-0 mt-0.5" />
                      {c.why}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void showSample(c.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-hover"
                  >
                    <Eye size={13} />
                    Sample
                  </button>
                  {c.purgeable && c.count > 0 && (
                    <button
                      onClick={() => setConfirming({ id: c.id, count: c.count })}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-xs font-medium text-danger disabled:opacity-50 hover:brightness-110"
                    >
                      <Trash2 size={13} />
                      Purge
                    </button>
                  )}
                </div>
              </div>

              {sample?.id === c.id && (
                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-surface border border-line p-2.5">
                  {sample.lines.length === 0 && (
                    <p className="text-xs text-ink-subtle">Nothing in this category.</p>
                  )}
                  {sample.lines.map((line, i) => (
                    <code key={i} className="block text-xs font-mono text-ink-muted truncate">
                      {line.split("\n")[0]}
                      {line.includes("\n") && " …"}
                    </code>
                  ))}
                </div>
              )}

              {confirming?.id === c.id && (
                <div className="mt-3 rounded-lg border border-danger/40 bg-danger-soft p-3">
                  <p className="text-xs text-danger inline-flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    Removes about {confirming.count.toLocaleString()} commands on every
                    synced machine. There is no undo.
                  </p>
                  {progress && <p className="text-xs text-ink-muted mt-2">{progress}</p>}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => void purge(c)}
                      disabled={busy !== null}
                      className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
                    >
                      {busy === c.id ? "Removing…" : "Yes, purge"}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                    >
                      <X size={13} />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
