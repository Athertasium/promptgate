"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { StatCard } from "./_components/stat-card";
import { Empty } from "./_components/empty";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

type OverviewData = {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  cacheHitRate: number;
  costByHourProvider: { hour: string; provider: string; cost: number }[];
  latencyByHour: { hour: string; p50: number; p95: number }[];
  tokensByHour: { hour: string; input: number; output: number }[];
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "rgba(139,92,246,0.8)",
  openai: "rgba(52,211,153,0.8)",
  groq: "rgba(251,146,60,0.8)",
  unknown: "rgba(113,113,122,0.8)",
};

function buildCostChart(data: OverviewData["costByHourProvider"]) {
  const hours = [...new Set(data.map((r) => r.hour))].sort();
  const providers = [...new Set(data.map((r) => r.provider))];
  const datasets = providers.map((p) => {
    const byHour = Object.fromEntries(
      data.filter((r) => r.provider === p).map((r) => [r.hour, r.cost])
    );
    return {
      label: p,
      data: hours.map((h) => byHour[h] ?? 0),
      borderColor: PROVIDER_COLORS[p] ?? "rgba(99,102,241,0.8)",
      backgroundColor: (PROVIDER_COLORS[p] ?? "rgba(99,102,241,0.2)").replace("0.8", "0.15"),
      fill: true,
      tension: 0.3,
    };
  });
  return { labels: hours.map((h) => new Date(h).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), datasets };
}

function buildTokenChart(data: OverviewData["tokensByHour"]) {
  return {
    labels: data.map((r) => new Date(r.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
    datasets: [
      {
        label: "input",
        data: data.map((r) => r.input),
        borderColor: "rgba(99,102,241,0.8)",
        backgroundColor: "rgba(99,102,241,0.15)",
        fill: true,
        tension: 0.3,
      },
      {
        label: "output",
        data: data.map((r) => r.output),
        borderColor: "rgba(52,211,153,0.8)",
        backgroundColor: "rgba(52,211,153,0.15)",
        fill: true,
        tension: 0.3,
      },
    ],
  };
}

function buildLatencyChart(data: OverviewData["latencyByHour"]) {
  return {
    labels: data.map((r) => new Date(r.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
    datasets: [
      {
        label: "p50",
        data: data.map((r) => r.p50),
        borderColor: "rgba(52,211,153,0.8)",
        backgroundColor: "transparent",
        tension: 0.3,
      },
      {
        label: "p95",
        data: data.map((r) => r.p95),
        borderColor: "rgba(251,146,60,0.8)",
        backgroundColor: "transparent",
        tension: 0.3,
        borderDash: [4, 3],
      },
    ],
  };
}

const chartOpts = {
  responsive: true,
  plugins: { legend: { labels: { color: "#a1a1aa" } } },
  scales: {
    x: { ticks: { color: "#71717a" }, grid: { color: "#27272a" } },
    y: { ticks: { color: "#71717a" }, grid: { color: "#27272a" } },
  },
};

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/overview")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="text-rose-400">Failed to load data.</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total requests" value={data.totalRequests.toLocaleString()} />
        <StatCard
          label="Total cost"
          value={`$${data.totalCost.toFixed(4)}`}
          accent="indigo"
        />
        <StatCard
          label="Total tokens"
          value={data.totalTokens.toLocaleString()}
          accent="violet"
        />
        <StatCard
          label="Cache hit rate"
          value={`${(data.cacheHitRate * 100).toFixed(1)}%`}
          accent="green"
          sub="exact-match"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-400">Cost / hour by provider (24 h)</p>
          {data.costByHourProvider.length === 0 ? (
            <Empty />
          ) : (
            <Line data={buildCostChart(data.costByHourProvider)} options={chartOpts} />
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-400">Latency p50 / p95 ms (24 h)</p>
          {data.latencyByHour.length === 0 ? (
            <Empty />
          ) : (
            <Line data={buildLatencyChart(data.latencyByHour)} options={chartOpts} />
          )}
        </div>
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-400">Tokens / hour — input vs output (24 h)</p>
          {data.tokensByHour.length === 0 ? (
            <Empty />
          ) : (
            <Line data={buildTokenChart(data.tokensByHour)} options={chartOpts} />
          )}
        </div>
      </div>
    </div>
  );
}
