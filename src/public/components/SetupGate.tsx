import React, { useEffect, useState } from "react";
import { LogIn, KeyRound } from "lucide-react";

interface SetupStatus {
  profile: string;
  loggedIn: boolean;
  hostId?: string;
  needsSetup: boolean;
  atuinInstalled: boolean;
  historyAvailable: boolean;
  /** No binary: the setup form cannot do anything useful. */
  blocked: boolean;
}

/**
 * First-run bootstrap.
 *
 * Credentials are collected here rather than stored in .env: the password is
 * used once by `atuin login` and never persisted by the dashboard, and the key
 * is handed to atuin which writes it to data_dir/key at 0600. Once meta.db
 * holds a session token this gate never appears again.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));

  useEffect(() => {
    refresh();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, key }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.message ?? "Login failed.");
        return;
      }
      // Drop the secrets from component state immediately on success.
      setPassword("");
      setKey("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  // The dashboard shells out to the binary for every mutation, so without it
  // there is no recovery path from inside the UI.
  if (status.blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md">
          <h1 className="text-2xl font-bold text-ink mb-2 flex items-center gap-2">
            <KeyRound size={20} className="text-warn" />
            atuin is not installed
          </h1>
          <p className="text-ink-muted text-sm">
            The dashboard reads the atuin client's database and shells out to the
            <code className="font-mono mx-1">atuin</code> binary for every mutation.
            Neither is available on this host.
          </p>
          <p className="text-ink-subtle text-xs mt-4">
            Install atuin and restart, or run the dashboard image, which bundles the
            client.
          </p>
        </div>
      </div>
    );
  }

  if (!status.needsSetup) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={submit} className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-ink mb-1 flex items-center gap-2">
          <KeyRound size={20} className="text-ink-muted" />
          Connect to Atuin sync
        </h1>
        <p className="text-ink-subtle text-sm mb-6">
          This client (<code className="font-mono">{status.profile}</code>) has never logged in.
          Credentials are used once and are not stored by the dashboard.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-2">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full bg-raised border border-line rounded-lg px-4 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-raised border border-line rounded-lg px-4 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-2">
              Encryption key
            </label>
            <textarea
              value={key}
              onChange={(e) => setKey(e.target.value)}
              rows={3}
              placeholder="your bip39 recovery phrase"
              className="w-full bg-raised border border-line rounded-lg px-4 py-2 text-sm font-mono text-ink placeholder-ink-subtle"
            />
            <p className="text-ink-subtle text-xs mt-1.5">
              Atuin stores this at <code className="font-mono">data_dir/key</code>; it is needed
              to decrypt every future sync.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password || !key}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-soft border border-brand/40 text-brand text-sm font-medium disabled:opacity-40 hover:brightness-110"
        >
          <LogIn size={15} />
          {busy ? "Logging in…" : "Log in and sync"}
        </button>
      </form>
    </div>
  );
}
