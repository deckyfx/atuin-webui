import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, Trash2, X, CopyMinus, RefreshCw, Scissors, AlertTriangle, Sparkles, Check } from "lucide-react";
import { NOISE_VERBS } from "../lib/noise";
import { getJson, postJson, errorMessage, hasNumber, isArray, HttpError } from "../lib/http";

interface VerbCount {
  verb: string;
  count: number;
}

interface DedupPreview {
  removable: number;
  groups: number;
  fingerprint: string;
  sample: Array<{ command: string; copies: number }>;
}

interface PreviewResult {
  /** Entries that will be deleted, duplicates included. */
  total: number;
  /** Distinct commands among them. */
  unique: number;
  sample: string[];
}

type SearchMode = "prefix" | "full-text" | "fuzzy";

/** The shape sent to the prune endpoints. */
interface SearchRule {
  query: string;
  searchMode: SearchMode;
  filterMode: "global";
  before?: string;
}

/**
 * Batch pruning.
 *
 * Deletion always goes through `atuin search --delete`, never SQL: the change
 * has to be appended to the encrypted record store to sync to other machines.
 * Preview runs the identical query without `--delete`, so what is shown is
 * exactly what will be removed.
 */
export function PrunePage() {
  const [verbs, setVerbs] = useState<VerbCount[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("prefix");
  const [before, setBefore] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // The rule and verb set the preview was taken with. The confirm deletes
  // these, not whatever the inputs hold when it is clicked: editing the query
  // after previewing would otherwise delete something never shown.
  const [previewedRule, setPreviewedRule] = useState<SearchRule | null>(null);
  const [previewedVerbs, setPreviewedVerbs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // One-click verb purge: chips are multi-selectable and previewed together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verbPreview, setVerbPreview] = useState<{ total: number; unique: number; bare: number } | null>(null);
  const [verbConfirming, setVerbConfirming] = useState(false);
  const [dedupConfirming, setDedupConfirming] = useState(false);
  /** Invalidates in-flight previews when the chip selection changes. */
  const previewSeq = useRef(0);

  /**
   * Every chip-selection change goes through here.
   *
   * Bumping the sequence alone is not enough: previewVerbs only clears `busy`
   * when its sequence is still current, so invalidating without settling the
   * state left the controls disabled for good.
   */
  const changePicked = useCallback((next: Set<string>) => {
    previewSeq.current += 1;
    setPicked(next);
    setVerbPreview(null);
    setVerbConfirming(false);
    setPreviewedVerbs([]);
    setBusy(false);
  }, []);
  const [dedupPreview, setDedupPreview] = useState<DedupPreview | null>(null);



  /** Refetched after every mutation: the counts these chips show are exactly
   *  what the delete just changed, so a stale list invites deleting nothing. */
  const loadVerbs = useCallback(() => {
    getJson<VerbCount[]>("/api/history/verbs", { expect: isArray })
      .then(setVerbs)
      .catch((err) => setResult(`Could not load commands: ${errorMessage(err)}`));
  }, []);

  useEffect(loadVerbs, [loadVerbs]);

  const rule = () => ({
    query,
    searchMode,
    filterMode: "global" as const,
    ...(before ? { before } : {}),
  });

  /** Sends the fingerprint of the scope the user actually saw, so a changed
   *  duplicate set is rejected rather than silently deleted. */
  async function runDedup(expectedFingerprint: string) {
    setBusy(true);
    try {
      const body = await postJson<{ output?: string }>("/api/dedup", {
        expectedFingerprint,
      });
      setResult(body.output || "Duplicates removed.");
      setDedupConfirming(false);
      setDedupPreview(null);
      loadVerbs();
    } catch (err) {
      // 409 is a normal outcome, not a failure: history moved between the
      // preview and the confirm, and the response carries the new scope. The
      // stale preview must be replaced, never left on screen next to a
      // confirm button.
      if (err instanceof HttpError && err.status === 409) {
        // Validated, not cast: this is a response body, and a malformed one
        // would render "undefined duplicate entries" beside a confirm button.
        const candidate = (err.body as { preview?: unknown })?.preview;
        const fresh =
          candidate &&
          typeof (candidate as DedupPreview).removable === "number" &&
          typeof (candidate as DedupPreview).groups === "number"
            ? (candidate as DedupPreview)
            : null;
        setDedupPreview(fresh);
        setDedupConfirming(false);
        setResult(
          fresh
            ? `${err.message} Showing the updated scope — review and confirm again.`
            : err.message
        );
        return;
      }
      setDedupPreview(null);
      setDedupConfirming(false);
      setResult(`Dedup failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function previewDedup() {
    setBusy(true);
    setResult(null);
    try {
      setDedupPreview(
        await getJson<DedupPreview>("/api/dedup/preview", {
          expect: hasNumber("removable", "groups"),
        })
      );
      setDedupConfirming(true);
    } catch (err) {
      setResult(`Preview failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function previewVerbs() {
    setBusy(true);
    setResult(null);
    const seq = ++previewSeq.current;
    try {
      const taken = [...picked];
      const preview = await postJson<{ total: number; unique: number; bare: number }>(
        "/api/prune/preview-verbs",
        { verbs: taken },
        // Every field the confirm renders: validating `total` alone let the
        // others arrive undefined and reach the UI as "undefined".
        { expect: hasNumber("total", "unique", "bare") }
      );
      // A preview for a chip selection the user has since changed must not arm
      // the confirm — the same race HistoryPage guards.
      if (seq !== previewSeq.current) return;
      setVerbPreview(preview);
      setPreviewedVerbs(taken);
    } catch (err) {
      if (seq !== previewSeq.current) return;
      setResult(`Preview failed: ${errorMessage(err)}`);
      setVerbPreview(null);
    } finally {
      if (seq === previewSeq.current) setBusy(false);
    }
  }

  async function purgeVerbs() {
    setBusy(true);
    try {
      if (previewedVerbs.length === 0) return;
      const body = await postJson<{
        removed: number;
        results?: Array<{ ok: boolean }>;
      }>("/api/prune/execute-verbs", { verbs: previewedVerbs });
      const failed = (body.results ?? []).filter((r: { ok: boolean }) => !r.ok);
      setResult(
        failed.length
          ? `Purged ${body.removed?.toLocaleString() ?? 0} entries; ${failed.length} command(s) refused.`
          : `Purged ${body.removed?.toLocaleString() ?? 0} entries.`
      );
      changePicked(new Set());
      loadVerbs();
    } catch (err) {
      // Covers both a rejected request and a non-2xx: a purge that did not
      // happen must never read as one that did.
      setResult(`Purge failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!query.trim()) return;
    setBusy(true);
    setResult(null);
    setConfirming(false);
    try {
      const taken = rule();
      setPreview(
        await postJson<PreviewResult>("/api/prune/preview", taken, {
          // Both counts: the confirm renders "N entries" and "M distinct".
          expect: hasNumber("total", "unique"),
        })
      );
      setPreviewedRule(taken);
    } catch (err) {
      setResult(`Preview failed: ${errorMessage(err)}`);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    setBusy(true);
    try {
      if (!previewedRule) return;
      const body = await postJson<{ output?: string }>("/api/prune/execute", previewedRule);
      setResult(`Deleted. ${body.output ?? ""}`.trim());
      setPreview(null);
      setPreviewedRule(null);
      setConfirming(false);
      loadVerbs();
      setQuery("");
    } catch (err) {
      setResult(`Failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string) {
    setBusy(true);
    try {
      const body = await postJson<{ output?: string; success?: boolean }>(path);
      setResult(body.output || (body.success ? "Done." : "Failed."));
      loadVerbs();
    } catch (err) {
      setResult(errorMessage(err, "Request failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-ink mb-1 flex items-center gap-2">
        <Scissors size={22} className="text-ink-muted" />
        Batch Prune
      </h1>
      <p className="text-ink-subtle text-sm mb-6">
        Deletions are appended as records and propagate to every synced machine.
      </p>

      <div className="rounded-xl border border-line p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-wider text-ink-subtle">Noisiest commands</p>
          <button
            onClick={() => {
              const available = verbs.filter((v) => NOISE_VERBS.includes(v.verb)).map((v) => v.verb);
              changePicked(new Set(available));
            }}
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
          >
            <Sparkles size={13} />
            Select navigation noise
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {verbs.slice(0, 14).map((v) => {
            const on = picked.has(v.verb);
            return (
              <button
                key={v.verb}
                onClick={() => {
                  const next = new Set(picked);
                  if (next.has(v.verb)) next.delete(v.verb);
                  else next.add(v.verb);
                  changePicked(next);
                }}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
                  on
                    ? "border-warn/50 bg-warn-soft text-warn"
                    : "bg-raised border-line text-ink-muted hover:border-brand/40"
                }`}
              >
                {on && <Check size={12} />}
                <code className="font-mono">{v.verb || "(blank)"}</code>
                <span className="opacity-60">{v.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>

        {picked.size > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            {!verbPreview ? (
              <button
                onClick={previewVerbs}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-hover text-ink text-sm font-medium disabled:opacity-40 hover:brightness-110"
              >
                <Search size={14} />
                {busy ? "Working…" : `Purge ${picked.size} command${picked.size === 1 ? "" : "s"}…`}
              </button>
            ) : (
              <div>
                <p className="text-warn font-semibold text-sm mb-1">
                  {verbPreview.total.toLocaleString()} entries would be deleted
                </p>
                <p className="text-ink-subtle text-xs mb-3">
                  Everything invoking {[...picked].map((v) => `\`${v}\``).join(", ")} with
                  arguments. Commands that merely share an opening —{" "}
                  <code className="font-mono">lsof</code> for <code className="font-mono">ls</code>{" "}
                  — are not touched.
                  {verbPreview.bare > 0 && (
                    <>
                      {" "}
                      {verbPreview.bare.toLocaleString()} bare invocation
                      {verbPreview.bare === 1 ? "" : "s"} stay: removing those needs a
                      bare-prefix delete that would take the neighbours too.
                    </>
                  )}
                </p>
                {!verbConfirming ? (
                  <button
                    onClick={() => setVerbConfirming(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-danger-soft border border-danger/40 text-danger text-sm font-medium hover:brightness-110"
                  >
                    <Trash2 size={14} />
                    Delete these {verbPreview.total.toLocaleString()}…
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 text-danger text-sm">
                      <AlertTriangle size={14} />
                      Propagates to every machine. Sure?
                    </span>
                    <button
                      onClick={purgeVerbs}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg bg-danger text-surface text-sm font-medium disabled:opacity-40"
                    >
                      {busy ? "Deleting…" : "Yes, purge"}
                    </button>
                    <button
                      onClick={() => setVerbConfirming(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-ink-muted text-sm hover:text-ink"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line p-5 mb-5 space-y-4">
        <div>
          <label
            htmlFor="prune-match"
            className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
          >
            Match
          </label>
          <input
            id="prune-match"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPreview(null);
            }}
            placeholder="e.g. cd"
            className="w-full bg-raised border border-line rounded-lg px-4 py-2 text-sm font-mono text-ink placeholder-ink-subtle focus:outline-none focus:border-brand/50"
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label
              htmlFor="prune-mode"
              className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
            >
              Mode
            </label>
            <select
              id="prune-mode"
              value={searchMode}
              onChange={(e) => {
                setSearchMode(e.target.value as SearchMode);
                setPreview(null);
              }}
              className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink"
            >
              <option value="prefix">Prefix</option>
              <option value="full-text">Contains</option>
              <option value="fuzzy">Fuzzy</option>
            </select>
          </div>
          <div className="flex-1">
            <label
              htmlFor="prune-before"
              className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
            >
              Older than (optional)
            </label>
            <input
              id="prune-before"
              value={before}
              onChange={(e) => {
                setBefore(e.target.value);
                setPreview(null);
              }}
              placeholder="e.g. 30 days ago"
              className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-subtle"
            />
          </div>
        </div>

        <button
          onClick={runPreview}
          disabled={busy || !query.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-hover text-ink text-sm font-medium disabled:opacity-40 hover:brightness-110"
        >
          <Search size={14} />
          {busy ? "Working…" : "Preview matches"}
        </button>
      </div>

      {preview && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft p-5 mb-5">
          <p className="text-warn font-semibold mb-1">
            {preview.total.toLocaleString()} entries would be deleted
          </p>
          <p className="text-ink-subtle text-xs mb-4">
            {preview.unique !== preview.total && (
              <>
                {preview.unique.toLocaleString()} distinct commands, run{" "}
                {preview.total.toLocaleString()} times in total.{" "}
              </>
            )}
            This removes them from every synced machine on next sync.
          </p>

          {preview.total > 0 && (
            <>
              <div className="max-h-56 overflow-y-auto rounded-lg bg-surface border border-line p-3 mb-4">
                {preview.sample.map((cmd, i) => (
                  <code key={i} className="block text-xs font-mono text-ink-muted truncate">
                    {cmd}
                  </code>
                ))}
                {preview.unique > preview.sample.length && (
                  <p className="text-ink-subtle text-xs mt-2">
                    …and {(preview.unique - preview.sample.length).toLocaleString()} more
                    distinct commands
                  </p>
                )}
              </div>

              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-danger-soft border border-danger/40 text-danger text-sm font-medium hover:brightness-110"
                >
                  <Trash2 size={14} />
                  Delete these {preview.total.toLocaleString()}…
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-danger text-sm">
                    <AlertTriangle size={14} />
                    Are you sure?
                  </span>
                  <button
                    onClick={runDelete}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-danger text-surface text-sm font-medium disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-ink-muted text-sm hover:text-ink"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => {
            // Dedup deletes across every synced machine like any other prune,
            // so it shows its scope first and confirms second, rather than
            // firing on a single click.
            if (dedupConfirming && dedupPreview) {
              void runDedup(dedupPreview.fingerprint);
            } else {
              void previewDedup();
            }
          }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-raised border border-line text-ink-muted text-sm hover:text-ink hover:bg-hover disabled:opacity-40"
        >
          <CopyMinus size={14} />
          {dedupConfirming
            ? `Confirm: delete ${dedupPreview?.removable.toLocaleString() ?? ""} duplicates`
            : "Remove duplicates"}
        </button>
        <button
          onClick={() => post("/api/sync")}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-raised border border-line text-ink-muted text-sm hover:text-ink hover:bg-hover disabled:opacity-40"
        >
          <RefreshCw size={14} />
          Sync now
        </button>
      </div>

      {dedupPreview && dedupConfirming && (
        <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft p-5">
          <p className="text-warn font-semibold text-sm mb-1">
            {dedupPreview.removable.toLocaleString()} duplicate entries would be deleted
          </p>
          <p className="text-ink-subtle text-xs mb-3">
            Across {dedupPreview.groups.toLocaleString()} commands that repeat with the same
            directory and machine. One copy of each is kept.
          </p>
          {dedupPreview.sample.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-surface border border-line p-2.5">
              {dedupPreview.sample.map((d) => (
                <div key={d.command} className="flex gap-3 text-xs">
                  <code className="font-mono text-ink-muted truncate flex-1">{d.command}</code>
                  <span className="text-ink-subtle tabular-nums shrink-0">×{d.copies}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              setDedupConfirming(false);
              setDedupPreview(null);
            }}
            className="mt-3 text-xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {result && (
        <pre className="mt-5 rounded-lg bg-raised border border-line p-4 text-xs text-ink-muted whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}
