import React, { useEffect, useState } from "react";
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

  async function load() {
    const res = await fetch("/api/users");
    if (!res.ok) {
      setError("Failed to load users");
    } else {
      setUsers(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(userId: number) {
    if (confirmDelete !== userId) {
      setConfirmDelete(userId);
      return;
    }
    setDeleting(userId);
    setConfirmDelete(null);
    const r = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    if (r.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      setError("Failed to delete user");
    }
    setDeleting(null);
  }

  if (loading) return <div className="text-ink-subtle text-sm p-8">Loading…</div>;
  if (error) return <div className="text-danger text-sm p-8">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Users</h1>
        <p className="text-ink-subtle text-sm mt-1">{users.length} registered account{users.length !== 1 ? "s" : ""}</p>
      </div>

      {users.length === 0 ? (
        <div className="text-ink-subtle text-sm">No users found.</div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
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
                  <td className="px-4 py-3 text-ink-subtle text-xs">{String(user.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmDelete === user.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-warn">Confirm?</span>
                        <button
                          onClick={() => handleDelete(user.id)}
                          disabled={deleting === user.id}
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
