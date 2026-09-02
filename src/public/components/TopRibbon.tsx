import React, { useEffect, useState } from "react";
import { RefreshCw, Sun, Moon, MonitorSmartphone, ShieldAlert, Database } from "lucide-react";
import { useThemeStore } from "../stores/theme-store";
import type { ThemePreference } from "../stores/theme-store";
import { useToastStore } from "../stores/toast-store";

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

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json();
      push(body.success ? "success" : "error", body.output || "Sync finished.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const live = status?.profile === "live";

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 h-12 px-5 border-b border-line bg-overlay/85 backdrop-blur-md">
      <div
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
          live
            ? "border-warn/40 bg-warn-soft text-warn"
            : "border-line bg-raised text-ink-muted"
        }`}
        title={
          live
            ? "Deletions reach every synced machine"
            : "Disposable sandbox client — safe to experiment"
        }
      >
        {live ? <ShieldAlert size={13} /> : <Database size={13} />}
        {status ? status.profile : "…"}
      </div>

      <div className="flex-1" />

      <button
        onClick={sync}
        disabled={syncing}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-hover disabled:opacity-50"
      >
        <RefreshCw size={13} className={syncing ? "animate-spin" : undefined} />
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
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
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
          <pre className="whitespace-pre-wrap font-sans">{t.message}</pre>
        </button>
      ))}
    </div>
  );
}
