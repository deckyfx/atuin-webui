import React, { useEffect, useState } from "react";

interface Session {
  id: number;
  userId: number | null;
  token: string;
  username: string | null;
  email: string | null;
}

function maskToken(token: string): string {
  if (token.length <= 12) return token;
  return token.slice(0, 6) + "••••••••••" + token.slice(-6);
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  async function load() {
    const res = await fetch("/api/sessions");
    if (!res.ok) {
      setError("Failed to load sessions");
    } else {
      setSessions(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleRevoke(sessionId: number) {
    if (confirmRevoke !== sessionId) {
      setConfirmRevoke(sessionId);
      return;
    }
    setRevoking(sessionId);
    setConfirmRevoke(null);
    const r = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    if (r.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } else {
      setError("Failed to revoke session");
    }
    setRevoking(null);
  }

  if (loading) return <div className="text-ink-subtle text-sm p-8">Loading…</div>;
  if (error) return <div className="text-danger text-sm p-8">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sessions</h1>
        <p className="text-ink-subtle text-sm mt-1">
          {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="text-ink-subtle text-sm">No active sessions.</div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
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
                    <div>
                      <p className="text-ink font-medium">{session.username ?? "—"}</p>
                      <p className="text-ink-subtle text-xs">{session.email ?? "unknown"}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                    {maskToken(session.token)}
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
                          onClick={() => setConfirmRevoke(null)}
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
