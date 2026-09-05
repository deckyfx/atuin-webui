import React, { useEffect, useRef, useState } from "react";
import { LogIn, KeyRound, Download } from "lucide-react";
import { getJson, postJson, errorMessage, HttpError } from "../lib/http";

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

  const [loadError, setLoadError] = useState<string | null>(null);
  const [unauthorised, setUnauthorised] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  // Retry can start concurrent requests; only the newest may write state, or a
  // slow earlier failure lands after a fast success and hides a working page.
  const requestSeq = useRef(0);

  const refresh = () => {
    const seq = ++requestSeq.current;
    return getJson<SetupStatus>("/api/setup/status")
      .then((s: SetupStatus) => {
        if (seq !== requestSeq.current) return;
        setStatus(s);
        setLoadError(null);
      })
      // `status === null` also means "still loading", so a failure that only
      // cleared it rendered a permanently blank page with no explanation.
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        // 401 is a distinct state, not a transport failure: the shell loaded
        // fine, the caller simply has no token. It gets its own screen with
        // the remedy rather than "cannot reach the API", which is misleading.
        if (err instanceof HttpError && err.status === 401) {
          setUnauthorised(true);
          setLoadError(null);
          return;
        }
        setLoadError(errorMessage(err));
      });
  };

  useEffect(() => {
    refresh();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/setup/login", { username, password, key });
      // Drop the secrets from component state immediately on success.
      setPassword("");
      setKey("");
      await refresh();
    } catch (err) {
      // Covers transport failure and a non-2xx alike.
      setError(errorMessage(err, "Login request failed."));
    } finally {
      setBusy(false);
    }
  }

  async function installAtuin() {
    setInstalling(true);
    setInstallError(null);
    try {
      await postJson("/api/doctor/install-atuin", {});
      // Re-read rather than assume: the status endpoint is what decides
      // whether this screen still applies.
      await refresh();
    } catch (err) {
      setInstallError(errorMessage(err, "Could not install atuin"));
    } finally {
      setInstalling(false);
    }
  }

  // 401 is not a transport failure: the app shell loads for anyone, but the
  // data does not, so an unauthorised visitor sees an explanation rather than
  // a dashboard that silently shows nothing.
  if (unauthorised) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-lg">
          <h1 className="text-2xl font-bold text-ink mb-2 flex items-center gap-2">
            <KeyRound size={20} className="text-warn" />
            Token required
          </h1>
          <p className="text-ink-muted text-sm">
            This dashboard reads your shell history and can delete it on every
            synced machine, so the API requires a token. Loopback alone does not
            keep other accounts on this machine out.
          </p>
          <p className="text-ink-muted text-sm mt-3">
            Open the URL printed when the server started, or read the token and
            visit <code className="font-mono">/auth?token=&lt;token&gt;</code>:
          </p>
          <pre className="mt-3 rounded-lg border border-line bg-raised p-3 text-xs font-mono text-ink-muted overflow-x-auto">
            cat ~/.local/share/atuin-dashboard/api-token
          </pre>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md">
          <h1 className="text-xl font-semibold text-ink mb-2">Cannot reach the dashboard API</h1>
          <p className="text-ink-muted text-sm">{loadError}</p>
          <button
            onClick={() => refresh()}
            className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink hover:bg-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
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
            The dashboard can fetch it from GitHub Releases and verify its published
            checksum, or you can install atuin yourself and restart.
          </p>

          {installError && (
            <p className="mt-4 text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-2">
              {installError}
            </p>
          )}

          <button
            onClick={() => void installAtuin()}
            disabled={installing}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-brand/40 bg-brand-soft px-4 py-2 text-sm font-medium text-brand disabled:opacity-50 hover:brightness-110"
          >
            <Download size={15} />
            {installing ? "Downloading…" : "Download atuin"}
          </button>
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
            <label
              htmlFor="setup-username"
              className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
            >
              Username
            </label>
            <input
              id="setup-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full bg-raised border border-line rounded-lg px-4 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label
              htmlFor="setup-password"
              className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
            >
              Password
            </label>
            <input
              id="setup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-raised border border-line rounded-lg px-4 py-2 text-sm text-ink"
            />
          </div>
          <div>
            <label
              htmlFor="setup-key"
              className="block text-xs uppercase tracking-wider text-ink-subtle mb-2"
            >
              Encryption key
            </label>
            <textarea
              id="setup-key"
              // A bip39 phrase is a credential: keep it out of autofill stores
              // and out of a spellchecker, which may ship text to a service.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
          <p
            role="alert"
            className="mt-4 text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-2"
          >
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
