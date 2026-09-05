import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Terminal, Trash2, X, AlertTriangle } from "lucide-react";
import { useToastStore } from "../stores/toast-store";
import { getJson, postJson, errorMessage, isAbort, isArray, hasNumber } from "../lib/http";

interface HistoryRow {
  id: string;
  timestamp: number;
  duration: number;
  exit: number;
  command: string;
  cwd: string;
  hostname: string;
}

interface HistoryPageData {
  rows: HistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

/** atuin stores timestamps in nanoseconds. */
function formatTime(ns: number): string {
  return new Date(ns / 1_000_000).toLocaleString();
}

function formatDuration(ns: number): string {
  const ms = ns / 1_000_000;
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function HistoryPage() {
  const [data, setData] = useState<HistoryPageData | null>(null);
  const [search, setSearch] = useState("");
  const [host, setHost] = useState("");
  const [hosts, setHosts] = useState<Array<{ hostname: string; count: number }>>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Selection is by command *string*, not row id: atuin deletes by query, so
  // every occurrence of a selected command goes together.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  // Selection names commands; this is how many *entries* those commands cover,
  // which is the number that matters before an irreversible delete.
  const [batchPreview, setBatchPreview] = useState<{ total: number } | null>(null);
  // The commands the preview covered. Deleting `selected` instead would remove
  // rows ticked after the count was shown.
  const [previewedCommands, setPreviewedCommands] = useState<string[]>([]);
  /** Invalidates in-flight previews when the selection changes. */
  const previewSeq = useRef(0);
  /** True while a delete request is in flight; see changeSelection. */
  const deletingRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const push = useToastStore((s) => s.push);
  const limit = 50;

  useEffect(() => {
    getJson<Array<{ hostname: string; count: number }>>("/api/history/hosts", {
      expect: isArray,
    })
      .then(setHosts)
      .catch(() => setHosts([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) params.set("search", search);
    if (host) params.set("hostname", host);

    // Debounce so typing does not fire a query per keystroke, and abort in
    // flight on the next change: without it a slow earlier request can resolve
    // after a later one and overwrite current results with stale rows.
    const controller = new AbortController();
    const t = setTimeout(() => {
      getJson<HistoryPageData>(`/api/history?${params}`, {
        signal: controller.signal,
        // rows *and* total: the pager renders the count, so validating only
        // the array let "1–50 of undefined" reach the screen.
        expect: (v) =>
          isArray((v as HistoryPageData)?.rows) &&
          typeof (v as HistoryPageData)?.total === "number",
      })
        .then((d) => {
          setData(d);
          setLoadError(null);
        })
        .catch((err) => {
          if (isAbort(err)) return;
          setLoadError(errorMessage(err, "Failed to load history"));
          // Cleared, not retained: keeping the previous page's rows under the
          // new filters would show a selection that does not match what the
          // filters describe — and selection drives deletion.
          setData(null);
          changeSelection(() => new Set());
          push("error", errorMessage(err, "Failed to load history."));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [search, host, offset, reloadKey]);

  /**
   * Every selection change goes through here.
   *
   * Changing the selection invalidates any preview describing the old one: a
   * pending response would otherwise arm the confirm with a count for commands
   * the user has already deselected, and the delete sends `previewedCommands`.
   * Bumping the sequence here means no caller can forget to.
   */
  const changeSelection = useCallback(
    (update: (prev: Set<string>) => Set<string>) => {
      previewSeq.current += 1;
      setSelected(update);
      setConfirming(false);
      setBatchPreview(null);
      setPreviewedCommands([]);
      // Only a pending *preview* is released here. Clearing it unconditionally
      // re-enabled the controls in the middle of a delete, because a selection
      // change during the request looked the same as one before it.
      if (!deletingRef.current) setBusy(false);
    },
    []
  );

  const toggle = useCallback(
    (command: string) => {
      changeSelection((prev) => {
        const next = new Set(prev);
        if (next.has(command)) next.delete(command);
        else next.add(command);
        return next;
      });
    },
    [changeSelection]
  );

  const pageCommands = [...new Set(data?.rows.map((r) => r.command) ?? [])];
  const allSelected = pageCommands.length > 0 && pageCommands.every((c) => selected.has(c));
  const someSelected = pageCommands.some((c) => selected.has(c));

  function toggleAll() {
    changeSelection((prev) => {
      const next = new Set(prev);
      if (allSelected) pageCommands.forEach((c) => next.delete(c));
      else pageCommands.forEach((c) => next.add(c));
      return next;
    });
  }

  async function previewBatch() {
    setBusy(true);
    const seq = ++previewSeq.current;
    try {
      const taken = [...selected];
      const body = await postJson<{ total: number }>(
        "/api/history/preview-batch",
        { commands: taken },
        { expect: hasNumber("total") }
      );
      // A slower earlier preview must not arm the confirm: its count belongs
      // to a selection the user has already changed, and confirming would
      // delete a scope that was never shown.
      if (seq !== previewSeq.current) return;
      setPreviewedCommands(taken);
      setBatchPreview({ total: body.total });
      setConfirming(true);
    } catch (err) {
      if (seq !== previewSeq.current) return;
      push("error", err instanceof Error ? err.message : "Preview failed.");
    } finally {
      if (seq === previewSeq.current) setBusy(false);
    }
  }

  async function deleteSelected() {
    deletingRef.current = true;
    setBusy(true);
    try {
      const body = await postJson<{
        deleted: number;
        removedRows?: number;
        total: number;
        refused?: unknown[];
      }>(
        "/api/history/delete-batch",
        { commands: previewedCommands },
        // Both counts: the toast reports them, and "Deleted undefined of
        // undefined" is worse than an error.
        { expect: hasNumber("deleted", "total") }
      );

      if (body.refused?.length) {
        push(
          "error",
          `Deleted ${body.deleted} of ${body.total}. ${body.refused.length} refused: ` +
            `a prefix delete would also remove longer commands.`
        );
      } else {
        push("success", `Deleted ${body.deleted} command${body.deleted === 1 ? "" : "s"}.`);
      }

      changeSelection(() => new Set());
      // Back to the first page: deleting can shrink the result set past the
      // current offset, which would otherwise render an empty table that looks
      // like "no matching commands".
      setOffset(0);
      setReloadKey((k) => k + 1);
    } catch (err) {
      // Covers transport failure and non-2xx alike: a deletion that did not
      // happen must never clear the selection as though it had.
      push("error", errorMessage(err, "Delete failed."));
    } finally {
      deletingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-ink mb-1 flex items-center gap-2">
        <Terminal size={22} className="text-ink-muted" />
        Command History
      </h1>
      <p className="text-ink-subtle text-sm mb-6">
        Plaintext, read directly from the client's history.db — no key required.
      </p>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="Search commands…"
            className="w-full bg-raised border border-line rounded-lg pl-9 pr-4 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-brand/60"
          />
        </div>
        <select
          value={host}
          onChange={(e) => {
            setHost(e.target.value);
            setOffset(0);
          }}
          className="bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink"
        >
          <option value="">All hosts</option>
          {hosts.map((h) => (
            <option key={h.hostname} value={h.hostname}>
              {h.hostname} ({h.count})
            </option>
          ))}
        </select>
      </div>

      {/* Selection toolbar. Sticky so the action stays reachable while
          scrolling a long page of results. */}
      {selected.size > 0 && (
        <div className="sticky top-12 z-20 flex items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 mb-3">
          <span className="text-sm font-medium text-warn">
            {selected.size} command{selected.size === 1 ? "" : "s"} selected
          </span>
          <span className="text-xs text-ink-muted">
            Every occurrence of each is removed — atuin deletes by command, not by entry.
          </span>
          <span className="flex-1" />
          {!confirming ? (
            <button
              onClick={() => void previewBatch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger hover:brightness-110"
            >
              <Trash2 size={13} />
              Delete
            </button>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle size={13} />
                {batchPreview
                  ? `${batchPreview.total.toLocaleString()} ${
                      batchPreview.total === 1 ? "entry" : "entries"
                    } across ${selected.size} command${
                      selected.size === 1 ? "" : "s"
                    }. Propagates to every machine. Sure?`
                  : "Propagates to every machine. Sure?"}
              </span>
              <button
                onClick={deleteSelected}
                disabled={busy}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </>
          )}
          <button
            onClick={() => changeSelection(() => new Set())}
            aria-label="Clear selection"
            className="rounded-md p-1 text-ink-subtle hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {data && (
        <p className="text-ink-subtle text-xs mb-3">
          {data.total.toLocaleString()} matching commands
        </p>
      )}

      <div className="rounded-xl border border-line overflow-hidden">
        <table aria-label="Command history" className="w-full text-sm">
          <thead className="bg-raised text-ink-subtle text-xs uppercase tracking-wider">
            <tr>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  // Partial selections read as "none selected" without this,
                  // which misrepresents what a delete would cover.
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="Select all on this page"
                  className="accent-current cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 font-medium">Command</th>
              <th className="text-left px-4 py-3 font-medium w-40">Host</th>
              <th className="text-left px-4 py-3 font-medium w-44">When</th>
              <th className="text-right px-4 py-3 font-medium w-24">Took</th>
              <th className="text-right px-4 py-3 font-medium w-16">Exit</th>
              <th className="w-12"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-danger">
                  {loadError}
                </td>
              </tr>
            )}
            {!loading && !loadError && data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                  No matching commands.
                </td>
              </tr>
            )}
            {!loading &&
              data?.rows.map((row) => {
                const isSelected = selected.has(row.command);
                return (
                  <tr
                    key={row.id}
                    className={isSelected ? "bg-warn-soft/40" : "hover:bg-hover"}
                  >
                    <td className="px-3 py-2.5 align-top">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(row.command)}
                        aria-label={`Select ${row.command.slice(0, 40)}`}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <code
                        className="block text-ink font-mono text-xs break-all line-clamp-2"
                        title={row.command}
                      >
                        {row.command}
                      </code>
                      <p className="text-ink-subtle text-xs mt-0.5 truncate">{row.cwd}</p>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted text-xs">{row.hostname}</td>
                    <td className="px-4 py-2.5 text-ink-subtle text-xs">
                      {formatTime(row.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink-subtle text-xs">
                      {formatDuration(row.duration)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`text-xs font-mono ${
                          row.exit === 0 ? "text-ink-subtle" : "text-danger"
                        }`}
                      >
                        {row.exit}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => {
                          changeSelection(() => new Set([row.command]));
                          setConfirming(false);
                          setBatchPreview(null);
                        }}
                        aria-label="Delete this command"
                        title="Delete every occurrence of this command"
                        className="rounded-md p-1.5 text-ink-subtle hover:text-danger hover:bg-danger-soft"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {data && data.total > limit && (
        <div className="flex items-center justify-between mt-4">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-raised border border-line text-ink-muted hover:text-ink hover:bg-hover disabled:opacity-40"
          >
            <ChevronLeft size={14} />
            Previous
          </button>
          <span className="text-ink-subtle text-xs">
            {offset + 1}–{Math.min(offset + limit, data.total)} of{" "}
            {data.total.toLocaleString()}
          </span>
          <button
            disabled={offset + limit >= data.total}
            onClick={() => setOffset(offset + limit)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-raised border border-line text-ink-muted hover:text-ink hover:bg-hover disabled:opacity-40"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
