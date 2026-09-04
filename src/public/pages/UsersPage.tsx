import React, { useEffect, useRef, useState } from "react";
import { getJson, deleteJson, errorMessage, isArray, hasNumber, HttpError } from "../lib/http";
import { formatServerLocal } from "../lib/datetime";
interface User {
  id: number;
  username: string;
  email: string;
  createdAt: string;
  sessionCount: number;
  storeRecords: number;
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Invalidates an in-flight preview when the operator changes rows. */
  const previewSeq = useRef(0);
  const [deletePreview, setDeletePreview] = useState<{
    sessions: number;
    records: number;
  } | null>(null);

  async function load() {
    // try/finally: a rejected fetch previously skipped setLoading(false) and
    // left the page spinning, with an unhandled rejection.
    try {
      setUsers(await getJson<User[]>("/api/users", { expect: isArray }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(userId: number) {
    if (confirmDelete !== userId) {
      // Preview first: the cascade is not visible from the row, and deleting an
      // account also drops its sessions and every synced record.
      setConfirmDelete(userId);
      setDeletePreview(null);
      const seq = ++previewSeq.current;
      try {
        const preview = await getJson<{ sessions: number; records: number }>(
          `/api/users/${userId}/delete-preview`,
          { expect: hasNumber("records") }
        );
        // Bound to this request: a response for user A arriving after the
        // operator moved to user B would otherwise fill B's confirmation with
        // A's counts.
        if (seq !== previewSeq.current) return;
        setDeletePreview(preview);
      } catch (err) {
        if (seq !== previewSeq.current) return;
        // Close the confirm row rather than leaving it open with a disabled
        // button and no explanation of why it will never enable.
        setDeleteError(errorMessage(err, "Could not read what this would delete"));
        setConfirmDelete(null);
      }
      return;
    }
    // Confirmed against a specific preview, so send it: the server recomputes
    // the counts inside the transaction and refuses if the account grew.
    const confirmedScope = deletePreview;
    setDeleting(userId);
    setConfirmDelete(null);
    setDeleteError(null);
    try {
      await deleteJson(
        `/api/users/${userId}`,
        confirmedScope ? { expectedScope: confirmedScope } : undefined
      );
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        // Not a failure: the scope moved between preview and confirm. Show the
        // new numbers and ask again rather than reporting an error.
        const fresh = (err.body as { preview?: { sessions: number; records: number } })?.preview;
        setDeletePreview(fresh ?? null);
        setConfirmDelete(fresh ? userId : null);
        setDeleteError(errorMessage(err, "This account changed since it was previewed"));
        return;
      }
      // Per-row, not page-level: replacing the table with an error screen
      // hides the very list the user was working in.
      setDeleteError(errorMessage(err, "Failed to delete user"));
    } finally {
      // In finally: a rejected DELETE previously left the row disabled until
      // a page reload.
      setDeleting(null);
    }
  }

  if (loading) return <div className="text-ink-subtle text-sm p-8">Loading…</div>;
  if (error) return <div className="text-danger text-sm p-8">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Users</h1>
        {deleteError && (
          <p role="alert" className="text-danger text-sm mt-2 mb-1">
            {deleteError}
          </p>
        )}
        <p className="text-ink-subtle text-sm mt-1">{users.length} registered account{users.length !== 1 ? "s" : ""}</p>
      </div>

      {users.length === 0 ? (
        <div className="text-ink-subtle text-sm">No users found.</div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table aria-label="Sync-server user accounts" className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-hover">
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">ID</th>
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">Username</th>
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">Email</th>
                <th className="text-right px-4 py-3 text-ink-subtle font-medium">Sessions</th>
                <th className="text-right px-4 py-3 text-ink-subtle font-medium">Records</th>
                <th className="text-left px-4 py-3 text-ink-subtle font-medium">Registered</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <tr
                  key={user.id}
                  className={`border-b border-line ${i % 2 === 0 ? "" : "bg-raised"}`}
                >
                  <td className="px-4 py-3 text-ink-subtle text-xs">{user.id}</td>
                  <td className="px-4 py-3 font-medium text-ink">{user.username}</td>
                  <td className="px-4 py-3 text-ink-muted">{user.email}</td>
                  <td className="px-4 py-3 text-right text-ink-muted">{user.sessionCount}</td>
                  <td className="px-4 py-3 text-right text-brand font-medium">
                    {user.storeRecords.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-ink-subtle text-xs">{formatServerLocal(String(user.createdAt))}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmDelete === user.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-warn">
                          {deletePreview
                            ? `Delete user, ${deletePreview.sessions} session(s) and ${deletePreview.records.toLocaleString()} record(s)?`
                            : "Reading what this would delete…"}
                        </span>
                        <button
                          onClick={() => handleDelete(user.id)}
                          disabled={deleting === user.id || !deletePreview}
                          className="text-xs px-2 py-1 rounded bg-danger-soft text-danger border border-danger/30 hover:bg-danger-soft transition-colors"
                        >
                          Yes, delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs px-2 py-1 rounded bg-hover text-ink-muted hover:bg-hover transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDelete(user.id)}
                        disabled={deleting === user.id}
                        className="text-xs px-3 py-1 rounded bg-danger-soft text-danger border border-danger/20 hover:bg-danger-soft transition-colors disabled:opacity-40"
                      >
                        Delete
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
