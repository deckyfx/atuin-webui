import React, { useEffect, useState } from "react";
import { RefreshCw, Sun, Moon, MonitorSmartphone, ShieldAlert, Database } from "lucide-react";
import { useThemeStore } from "../stores/theme-store";
import type { ThemePreference } from "../stores/theme-store";
import { useToastStore } from "../stores/toast-store";
import { getJson, postJson, errorMessage } from "../lib/http";

interface SetupStatus {
  profile: string;
  loggedIn: boolean;
}

const THEMES: Array<{ value: ThemePreference; icon: typeof Sun; label: string }> = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "auto", icon: MonitorSmartphone, label: "Match system" },
];

/**
 * Sticky global ribbon.
 *
 * Carries the two things that must be reachable and visible from every page:
 * which profile is armed (a `live` prune reaches every synced machine) and a
 * manual sync.
 */
export function TopRibbon() {
  const { preference, setPreference } = useThemeStore();
  const push = useToastStore((s) => s.push);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);

  useEffect(() => {
    getJson<SetupStatus>("/api/setup/status")
      .then((s) => {
        setStatus(s);
        setStatusFailed(false);
      })
      // Failure and "still loading" are both `status === null`, but they are
      // not the same state: one resolves on its own, the other never will.
      // The badge says which rather than showing a spinner forever.
      .catch(() => {
        setStatus(null);
        setStatusFailed(true);
      });
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const body = await postJson<{ success?: boolean; output?: string }>("/api/sync");
      push(body.success ? "success" : "error", body.output || "Sync finished.");
    } catch (err) {
      // The server's message names the actual failure; "Sync finished" did not.
      push("error", errorMessage(err, "Sync failed."));
    } finally {
      setSyncing(false);
    }
  }

  const live = status?.profile === "live";
  // Until the status arrives the profile is unknown, and "safe to experiment"
  // is the one claim that must not be made on a guess.
  const known = status !== null;

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 h-12 px-5 border-b border-line bg-overlay/85 backdrop-blur-md">
      <div
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
          live && known
            ? "border-warn/40 bg-warn-soft text-warn"
            : "border-line bg-raised text-ink-muted"
        }`}
        title={
          !known
            ? statusFailed
              ? "Could not read the client profile — the dashboard API is unreachable"
              : "Checking which client profile is active…"
            : live
              ? "Deletions reach every synced machine"
              : status?.profile === "sandbox"
                ? "Disposable sandbox client — safe to experiment"
                : // Neither profile: say what it is rather than promising
                  // safety for a client this UI knows nothing about.
                  `Profile "${status?.profile}" — deletions affect whichever client this is`
        }
      >
        {known && live ? <ShieldAlert size={13} /> : <Database size={13} />}
        {/* "…" means still loading. A failed request never resolves, so it
            gets its own label rather than an ellipsis that waits forever. */}
        {status ? status.profile : statusFailed ? "unavailable" : "…"}
      </div>

      <div className="flex-1" />

      <button
        onClick={sync}
        disabled={syncing}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-hover disabled:opacity-50"
      >
        <RefreshCw size={13} className={syncing ? "motion-safe:animate-spin" : undefined} />
        {syncing ? "Syncing…" : "Sync"}
      </button>

      <div
        className="flex items-center rounded-lg border border-line p-0.5"
        role="group"
        aria-label="Colour theme"
      >
        {THEMES.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => setPreference(value)}
            title={label}
            aria-label={label}
            aria-pressed={preference === value}
            className={`rounded-md p-1.5 transition-colors ${
              preference === value
                ? "bg-hover text-ink"
                : "text-ink-subtle hover:text-ink-muted"
            }`}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
    </header>
  );
}

/** Transient feedback for ribbon and page actions. */
export function ToastStack() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`text-left rounded-lg border px-4 py-2.5 text-xs shadow-lg backdrop-blur ${
            t.kind === "error"
              ? "border-danger/40 bg-danger-soft text-danger"
              : t.kind === "success"
                ? "border-brand/40 bg-brand-soft text-brand"
                : "border-line bg-overlay text-ink-muted"
          }`}
        >
          {/* A span, not a pre: a button may only contain phrasing content,
              and the wrapping is what mattered here, not the element. */}
          <span className="block whitespace-pre-wrap font-sans">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
