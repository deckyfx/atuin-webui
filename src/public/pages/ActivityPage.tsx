import React, { useEffect, useState } from "react";

interface ActivityDay {
  date: string;
  count: number;
}

export function ActivityPage() {
  const [activity, setActivity] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats/activity")
      .then((r) => r.json())
      .then((data) => {
        setActivity(data as ActivityDay[]);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load activity");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-ink-subtle text-sm p-8">Loading…</div>;
  if (error) return <div className="text-danger text-sm p-8">{error}</div>;

  const maxCount = Math.max(...activity.map((a) => a.count), 1);
  const total = activity.reduce((sum, a) => sum + a.count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sync Activity</h1>
        <p className="text-ink-subtle text-sm mt-1">
          {total.toLocaleString()} records synced across {activity.length} day{activity.length !== 1 ? "s" : ""}
        </p>
      </div>

      {activity.length === 0 ? (
        <div className="text-ink-subtle text-sm">No sync activity found.</div>
      ) : (
        <div className="space-y-4">
          {/* Bar chart */}
          <div className="rounded-xl border border-line p-5 space-y-3">
            <h2 className="text-sm font-medium text-ink-muted uppercase tracking-wider">
              Records per Day
            </h2>
            <div className="space-y-2">
              {activity.map((day) => {
                const pct = (day.count / maxCount) * 100;
                return (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="text-xs text-ink-subtle w-24 shrink-0 text-right">{day.date}</span>
                    <div className="flex-1 h-5 bg-hover rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-sm transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-ink-muted w-16 shrink-0 text-right">
                      {day.count.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-line overflow-hidden">
            <table aria-label="Record-store activity by day" className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-hover">
                  <th className="text-left px-4 py-3 text-ink-subtle font-medium">Date</th>
                  <th className="text-right px-4 py-3 text-ink-subtle font-medium">Records Synced</th>
                  <th className="text-right px-4 py-3 text-ink-subtle font-medium">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((day, i) => (
                  <tr
                    key={day.date}
                    className={`border-b border-line ${i % 2 === 0 ? "" : "bg-raised"}`}
                  >
                    <td className="px-4 py-3 text-ink">{day.date}</td>
                    <td className="px-4 py-3 text-right text-brand font-medium">
                      {day.count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-subtle">
                      {((day.count / total) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong bg-hover">
                  <td className="px-4 py-3 text-ink-muted font-medium">Total</td>
                  <td className="px-4 py-3 text-right text-ink font-bold">
                    {total.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
