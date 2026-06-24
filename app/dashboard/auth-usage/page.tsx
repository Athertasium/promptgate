"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { StatCard } from "../_components/stat-card";
import { Empty } from "../_components/empty";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

type Caller = {
  caller_id: string;
  requests: number;
  cost: number;
  tokens: number;
  rate_limit_rpm: number | null;
  recent_rpm: number;
  allowed_tiers: string[];
};

type Key = {
  caller_id: string;
  rate_limit_rpm: number;
  allowed_tiers: string[];
  created_at: string;
};

type Data = { callers: Caller[]; keys: Key[] };

export default function AuthUsagePage() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetch("/api/auth-usage").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const totalCallers = new Set(data.callers.map((c) => c.caller_id)).size;
  const totalCost = data.callers.reduce((s, c) => s + c.cost, 0);
  const activeKeys = data.keys.length;

  const costBarData = {
    labels: data.callers.slice(0, 10).map((c) => c.caller_id),
    datasets: [
      {
        label: "Cost (USD)",
        data: data.callers.slice(0, 10).map((c) => Number(c.cost.toFixed(6))),
        backgroundColor: "rgba(99,102,241,0.7)",
      },
    ],
  };

  const chartOpts = {
    responsive: true,
    plugins: { legend: { labels: { color: "#a1a1aa" } } },
    scales: {
      x: { ticks: { color: "#71717a", maxRotation: 30 }, grid: { color: "#27272a" } },
      y: { ticks: { color: "#71717a" }, grid: { color: "#27272a" } },
    },
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Auth & Usage</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Unique callers" value={String(totalCallers)} />
        <StatCard label="Active API keys" value={String(activeKeys)} accent="indigo" />
        <StatCard label="Total cost" value={`$${totalCost.toFixed(4)}`} accent="violet" />
      </div>

      {data.callers.length === 0 ? (
        <Empty message="No caller data yet — authenticate requests with x-api-key to track usage" />
      ) : (
        <>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="mb-4 text-sm font-medium text-zinc-400">Cost by caller (top 10)</p>
            <Bar data={costBarData} options={chartOpts} />
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Caller ID</th>
                  <th className="px-4 py-3 font-medium">Requests</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Tokens</th>
                  <th className="px-4 py-3 font-medium">RPM limit</th>
                  <th className="px-4 py-3 font-medium">Last-min RPM</th>
                  <th className="px-4 py-3 font-medium">Utilization</th>
                  <th className="px-4 py-3 font-medium">Tiers</th>
                </tr>
              </thead>
              <tbody>
                {data.callers.map((c) => {
                  const util =
                    c.rate_limit_rpm != null && c.rate_limit_rpm > 0
                      ? (c.recent_rpm / c.rate_limit_rpm) * 100
                      : null;
                  return (
                    <tr key={c.caller_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-mono text-zinc-200 max-w-[160px] truncate">{c.caller_id}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-300">{c.requests.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-300">${c.cost.toFixed(4)}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">{c.tokens.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">
                        {c.rate_limit_rpm ?? "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">{c.recent_rpm}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {util != null ? (
                          <span className={`font-medium ${util >= 80 ? "text-rose-400" : util >= 50 ? "text-yellow-400" : "text-emerald-400"}`}>
                            {util.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-zinc-500">{c.allowed_tiers.join(", ") || "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.keys.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Active API keys</h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Caller ID</th>
                  <th className="px-4 py-3 font-medium">RPM limit</th>
                  <th className="px-4 py-3 font-medium">Allowed tiers</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.keys.map((k, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 font-mono text-zinc-200">{k.caller_id}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{k.rate_limit_rpm}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{k.allowed_tiers.join(", ")}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(k.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
