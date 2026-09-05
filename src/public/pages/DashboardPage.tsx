import React, { useEffect, useState } from "react";
import { StatCard } from "../components/StatCard";
import { Terminal, Server, Layers, Trash2 } from "lucide-react";
import { Card, Skeleton } from "../components/Card";
import { ActivityChart } from "../components/ActivityChart";
import { BarList } from "../components/BarList";
import { seriesColor } from "../components/viz";
import { getJson, errorMessage, isArray, hasNumber } from "../lib/http";
import { NOISE_VERBS } from "../lib/noise";

interface ClientOverview {
  profile: string;
  loggedIn: boolean;
  hostId?: string;
  historyDbPath: string;
  totalCommands: number;
  totalHosts: number;
  totalSessions: number;
}

interface VerbCount {
  verb: string;
  count: number;
}

interface HostCount {
  hostname: string;
  count: number;
}

interface DayCount {
  day: string;
  count: number;
}

/** Shared with the Prune page so the stat and the shortcut cannot disagree. */
const NOISE = new Set<string>(NOISE_VERBS);

export function DashboardPage() {
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  const [verbs, setVerbs] = useState<VerbCount[]>([]);
  const [hosts, setHosts] = useState<HostCount[]>([]);
  const [activity, setActivity] = useState<DayCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Distinct from "arrays are empty": a genuinely empty history would
  // otherwise show loading placeholders forever.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getJson<ClientOverview>("/api/client/overview", {
        // All three: validating one let the others arrive undefined and
        // render as "undefined" in a stat tile.
        expect: hasNumber("totalCommands", "totalHosts", "totalSessions"),
      }),
      getJson<VerbCount[]>("/api/history/verbs", { expect: isArray }),
      getJson<HostCount[]>("/api/history/hosts", { expect: isArray }),
      getJson<DayCount[]>("/api/history/activity", { expect: isArray }),
    ])
      .then(([o, v, h, a]) => {
        setOverview(o);
        setVerbs(v);
        setHosts(h);
        setActivity(a);
      })
      .catch((e) => setError(errorMessage(e, "Failed to load the overview")))
      .finally(() => setLoaded(true));
  }, []);

  const noiseCount = verbs
    .filter((v) => NOISE.has(v.verb))
    .reduce((sum, v) => sum + v.count, 0);
  const noisePct =
    overview && overview.totalCommands > 0
      ? Math.round((noiseCount / overview.totalCommands) * 100)
      : 0;

  if (error) {
    return (
      <div className="p-8">
        <p className="text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-3">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Overview</h1>
        <p className="text-ink-subtle text-sm mt-1">
          {overview ? (
            <>
              Reading <code className="font-mono text-ink-muted">{overview.profile}</code>{" "}
              profile — plaintext history, no key required.
            </>
          ) : (
            "Loading…"
          )}
        </p>
      </header>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Commands"
          value={overview ? overview.totalCommands.toLocaleString() : "—"}
          tone="brand" icon={Terminal}
        />
        <StatCard
          label="Machines"
          value={overview ? overview.totalHosts.toLocaleString() : "—"}
          icon={Server}
        />
        <StatCard
          label="Shell sessions"
          value={overview ? overview.totalSessions.toLocaleString() : "—"}
          icon={Layers}
        />
        <StatCard
          label="Navigation noise"
          value={overview ? `${noisePct}%` : "—"}
          sub={noiseCount ? `${noiseCount.toLocaleString()} prunable` : undefined}
          tone="warn" icon={Trash2}
        />
      </div>

      <Card title="Daily activity" sub="Commands recorded per day, last 30 days">
        {!loaded ? (
          <Skeleton height={160} />
        ) : (
          <ActivityChart data={activity} />
        )}
      </Card>

      <div className="grid grid-cols-2 gap-6">
        <Card title="Most-run commands" sub="By first word — the batch-prune targets">
          {!loaded ? (
            <Skeleton height={200} />
          ) : (
            <BarList items={verbs.slice(0, 10).map((v) => ({ label: v.verb, value: v.count }))} />
          )}
        </Card>

        <Card title="By machine" sub="Where the commands were run">
          {!loaded ? (
            <Skeleton height={200} />
          ) : (
            <BarList
              items={hosts.map((h, i) => ({
                label: h.hostname.split(":")[0] ?? h.hostname,
                value: h.count,
                color: seriesColor(i),
              }))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
