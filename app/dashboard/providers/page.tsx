"use client";

import { useEffect, useState } from "react";
import { StatCard } from "../_components/stat-card";
import { Empty } from "../_components/empty";

type Provider = {
  provider: string;
  total: number;
  failovers: number;
  last_failure: string | null;
};

type FailoverEvent = {
  id: string;
  created_at: string;
  from_provider: string;
  to_provider: string;
  reason: string;
  added_latency_ms: number | null;
};

type Data = { providers: Provider[]; recentFailovers: FailoverEvent[] };

const REASON_BADGE: Record<string, string> = {
  circuit_open: "bg-rose-900/60 text-rose-300",
  "5xx": "bg-orange-900/60 text-orange-300",
  timeout: "bg-yellow-900/60 text-yellow-300",
  rate_limit: "bg-violet-900/60 text-violet-300",
};

export default function ProvidersPage() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const totalFailovers = data.providers.reduce((s, p) => s + p.failovers, 0);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Provider Health</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Providers seen" value={String(data.providers.length)} />
        <StatCard
          label="Total failovers"
          value={String(totalFailovers)}
          accent={totalFailovers > 0 ? "red" : "green"}
        />
        <StatCard label="Failover events logged" value={String(data.recentFailovers.length)} sub="last 50" />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Requests</th>
              <th className="px-4 py-3 font-medium">Failovers</th>
              <th className="px-4 py-3 font-medium">Failover rate</th>
              <th className="px-4 py-3 font-medium">Last failure</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">No data</td>
              </tr>
            )}
            {data.providers.map((p) => (
              <tr key={p.provider} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-3 font-mono font-medium text-zinc-200">{p.provider}</td>
                <td className="px-4 py-3 tabular-nums text-zinc-300">{p.total.toLocaleString()}</td>
                <td className="px-4 py-3 tabular-nums text-zinc-300">{p.failovers}</td>
                <td className="px-4 py-3 tabular-nums text-zinc-400">
                  {p.total > 0 ? `${((p.failovers / p.total) * 100).toFixed(1)}%` : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs">
                  {p.last_failure ? new Date(p.last_failure).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Recent failover events</h2>
        {data.recentFailovers.length === 0 ? (
          <Empty message="No failovers recorded" />
        ) : (
          <div className="space-y-2">
            {data.recentFailovers.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm">
                <span className="text-xs text-zinc-600 w-32 shrink-0">
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
                <span className="font-mono text-zinc-300">{e.from_provider}</span>
                <span className="text-zinc-600">→</span>
                <span className="font-mono text-zinc-300">{e.to_provider}</span>
                <span className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${REASON_BADGE[e.reason] ?? "bg-zinc-800 text-zinc-400"}`}>
                  {e.reason}
                </span>
                {e.added_latency_ms != null && (
                  <span className="text-xs text-zinc-500">+{e.added_latency_ms}ms</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
