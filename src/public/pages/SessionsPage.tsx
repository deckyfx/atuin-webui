import React, { useEffect, useState } from "react";
import { getJson, deleteJson, errorMessage, isArray } from "../lib/http";

interface Session {
  id: number;
  userId: number | null;
  /** Already redacted server-side; the full token never leaves the server. */
  tokenFingerprint: string;
  username: string | null;
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function load() {
    // try/finally: a rejected fetch previously skipped setLoading(false) and
    // left the page on its spinner forever, with an unhandled rejection.
    try {
      setSessions(await getJson<Session[]>("/api/sessions", { expect: isArray }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load sessions"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRevoke(sessionId: number) {
    if (confirmRevoke !== sessionId) {
      setConfirmRevoke(sessionId);
      // The previous failure described a different attempt.
      setRevokeError(null);
      return;
    }
    setRevoking(sessionId);
    setConfirmRevoke(null);
    setRevokeError(null);
    try {
      await deleteJson(`/api/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      // Recorded per row, not as a page-level error: a failed revoke used to
      // replace the whole table with an error screen.
      setRevokeError(errorMessage(err, "Failed to revoke session"));
    } finally {
      // In finally: a rejected DELETE previously left the row disabled until
      // a page reload.
      setRevoking(null);
    }
  }

  if (loading) return <div className="text-ink-subtle text-sm p-8">Loading…</div>;
  if (error) return <div className="text-danger text-sm p-8">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sessions</h1>
        {revokeError && (
          <p role="alert" className="text-danger text-sm mt-2 mb-1">
            {revokeError}
          </p>
        )}
        <p className="text-ink-subtle text-sm mt-1">
          {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="text-ink-subtle text-sm">No active sessions.</div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table aria-label="Active sync-server sessions" className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-hover">
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">ID</th>
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">User</th>
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">Token</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session, i) => (
                <tr
                  key={session.id}
                  className={`border-b border-line ${i % 2 === 0 ? "" : "bg-raised"}`}
                >
                  <td className="px-4 py-3 text-ink-subtle text-xs">{session.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-ink font-medium">{session.username ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                    {session.tokenFingerprint}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmRevoke === session.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-warn">Revoke?</span>
                        <button
                          onClick={() => handleRevoke(session.id)}
                          disabled={revoking === session.id}
                          className="text-xs px-2 py-1 rounded bg-danger-soft text-danger border border-danger/30 hover:bg-danger-soft transition-colors"
                        >
                          Yes, revoke
                        </button>
                        <button
                          onClick={() => {
                            setConfirmRevoke(null);
                            // The error described the attempt being cancelled;
                            // leaving it up attaches it to the next one.
                            setRevokeError(null);
                          }}
                          className="text-xs px-2 py-1 rounded bg-hover text-ink-muted hover:bg-hover transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRevoke(session.id)}
                        disabled={revoking === session.id}
                        className="text-xs px-3 py-1 rounded bg-warn-soft text-warn border border-warn/20 hover:bg-warn-soft transition-colors disabled:opacity-40"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
