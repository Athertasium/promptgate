"use client";

import { useEffect, useState } from "react";
import { StatCard } from "../_components/stat-card";
import { Empty } from "../_components/empty";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

type TypeAction = { check_type: string; action: string; count: number };
type RecentEvent = {
  id: string;
  created_at: string;
  check_type: string;
  action: string;
  detail: unknown;
  request_id: string | null;
};
type Data = { byTypeAction: TypeAction[]; recent: RecentEvent[] };

export default function GuardrailsPage() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetch("/api/guardrails").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const total = data.byTypeAction.reduce((s, r) => s + r.count, 0);
  const blocked = data.byTypeAction.filter((r) => r.action === "blocked").reduce((s, r) => s + r.count, 0);
  const flagged = data.byTypeAction.filter((r) => r.action === "flagged").reduce((s, r) => s + r.count, 0);

  const types = [...new Set(data.byTypeAction.map((r) => r.check_type))];
  const barData = {
    labels: types,
    datasets: [
      {
        label: "flagged",
        data: types.map((t) => data.byTypeAction.find((r) => r.check_type === t && r.action === "flagged")?.count ?? 0),
        backgroundColor: "rgba(251,191,36,0.7)",
      },
      {
        label: "blocked",
        data: types.map((t) => data.byTypeAction.find((r) => r.check_type === t && r.action === "blocked")?.count ?? 0),
        backgroundColor: "rgba(239,68,68,0.7)",
      },
    ],
  };

  const ACTION_BADGE: Record<string, string> = {
    flagged: "bg-yellow-900/60 text-yellow-300",
    blocked: "bg-rose-900/60 text-rose-300",
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Guardrails</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total triggers" value={String(total)} />
        <StatCard label="Flagged" value={String(flagged)} accent="indigo" />
        <StatCard label="Blocked" value={String(blocked)} accent="red" />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-400">Triggers by check type</p>
        {data.byTypeAction.length === 0 ? (
          <Empty message="No guardrail events yet" />
        ) : (
          <Bar
            data={barData}
            options={{
              responsive: true,
              plugins: { legend: { labels: { color: "#a1a1aa" } } },
              scales: {
                x: { ticks: { color: "#71717a" }, grid: { color: "#27272a" } },
                y: { ticks: { color: "#71717a" }, grid: { color: "#27272a" }, beginAtZero: true },
              },
            }}
          />
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Recent events</h2>
        {data.recent.length === 0 ? (
          <Empty message="No guardrail events recorded" />
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Check type</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                    <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sm text-zinc-300">{e.check_type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_BADGE[e.action] ?? "bg-zinc-800 text-zinc-400"}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 font-mono">
                      {e.detail ? JSON.stringify(e.detail) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
