"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { StatCard } from "../_components/stat-card";
import { Empty } from "../_components/empty";

ChartJS.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

type StreamingData = {
  byProvider: { provider: string; p50: number; p95: number; count: number }[];
  byHour: { hour: string; provider: string; p50: number; p95: number }[];
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "rgba(139,92,246,0.8)",
  openai: "rgba(52,211,153,0.8)",
  groq: "rgba(251,146,60,0.8)",
  nvidia: "rgba(99,102,241,0.8)",
  unknown: "rgba(113,113,122,0.8)",
};

const chartOpts = {
  responsive: true,
  plugins: { legend: { labels: { color: "#a1a1aa" } } },
  scales: {
    x: { ticks: { color: "#71717a" }, grid: { color: "#27272a" } },
    y: {
      ticks: { color: "#71717a" },
      grid: { color: "#27272a" },
      title: { display: true, text: "ms", color: "#71717a" },
    },
  },
};

export default function StreamingPage() {
  const [data, setData] = useState<StreamingData | null>(null);

  useEffect(() => {
    fetch("/api/streaming").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const totalStreamed = data.byProvider.reduce((s, p) => s + p.count, 0);
  const overallP50 =
    data.byProvider.length > 0
      ? Math.round(data.byProvider.reduce((s, p) => s + p.p50 * p.count, 0) / Math.max(totalStreamed, 1))
      : 0;
  const overallP95 =
    data.byProvider.length > 0
      ? Math.round(data.byProvider.reduce((s, p) => s + p.p95 * p.count, 0) / Math.max(totalStreamed, 1))
      : 0;

  const barData = {
    labels: data.byProvider.map((p) => p.provider),
    datasets: [
      {
        label: "p50 TTFT (ms)",
        data: data.byProvider.map((p) => Math.round(p.p50)),
        backgroundColor: data.byProvider.map((p) => PROVIDER_COLORS[p.provider] ?? "rgba(99,102,241,0.8)"),
      },
      {
        label: "p95 TTFT (ms)",
        data: data.byProvider.map((p) => Math.round(p.p95)),
        backgroundColor: data.byProvider.map((p) =>
          (PROVIDER_COLORS[p.provider] ?? "rgba(99,102,241,0.8)").replace("0.8", "0.4")
        ),
      },
    ],
  };

  // line chart: p50 TTFT over time per provider
  const hours = [...new Set(data.byHour.map((r) => r.hour))].sort();
  const providers = [...new Set(data.byHour.map((r) => r.provider))];
  const lineData = {
    labels: hours.map((h) => new Date(h).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
    datasets: providers.map((p) => {
      const byHour = Object.fromEntries(
        data.byHour.filter((r) => r.provider === p).map((r) => [r.hour, r.p50])
      );
      return {
        label: `${p} p50`,
        data: hours.map((h) => Math.round(byHour[h] ?? 0)),
        borderColor: PROVIDER_COLORS[p] ?? "rgba(99,102,241,0.8)",
        backgroundColor: "transparent",
        tension: 0.3,
      };
    }),
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Streaming — Time to First Token</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Streamed requests" value={String(totalStreamed)} />
        <StatCard label="Overall p50 TTFT" value={totalStreamed > 0 ? `${overallP50} ms` : "—"} accent="green" />
        <StatCard label="Overall p95 TTFT" value={totalStreamed > 0 ? `${overallP95} ms` : "—"} accent={overallP95 > 2000 ? "red" : "indigo"} />
      </div>

      {totalStreamed === 0 ? (
        <Empty message="No streaming requests recorded yet — send stream: true requests to the gateway" />
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="mb-4 text-sm font-medium text-zinc-400">TTFT p50 / p95 by provider</p>
            <Bar data={barData} options={chartOpts} />
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="mb-4 text-sm font-medium text-zinc-400">TTFT p50 over time (24 h)</p>
            {data.byHour.length === 0 ? <Empty /> : <Line data={lineData} options={chartOpts} />}
          </div>
        </div>
      )}

      {totalStreamed > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Streamed</th>
                <th className="px-4 py-3 font-medium">p50 TTFT</th>
                <th className="px-4 py-3 font-medium">p95 TTFT</th>
              </tr>
            </thead>
            <tbody>
              {data.byProvider.map((p) => (
                <tr key={p.provider} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 font-mono font-medium text-zinc-200">{p.provider}</td>
                  <td className="px-4 py-3 tabular-nums text-zinc-300">{p.count.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums text-zinc-300">{Math.round(p.p50)} ms</td>
                  <td className="px-4 py-3 tabular-nums text-zinc-400">{Math.round(p.p95)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
