"use client";

import { useEffect, useRef, useState } from "react";
import { StatCard } from "../_components/stat-card";
import { Empty } from "../_components/empty";
import {
  Chart as ChartJS,
  ScatterController,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
  type TooltipItem,
} from "chart.js";
import { Scatter } from "react-chartjs-2";

ChartJS.register(ScatterController, PointElement, LinearScale, Tooltip, Legend);

type CacheData = {
  exactHitRate: number;
  exactHits: number;
  totalRequests: number;
  savedCost: number;
  threshold: number;
  semanticPoints: { score: number; wouldHit: boolean; at: string }[];
};

export default function CachePage() {
  const [data, setData] = useState<CacheData | null>(null);

  useEffect(() => {
    fetch("/api/cache").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const hits = data.semanticPoints.filter((p) => p.wouldHit);
  const misses = data.semanticPoints.filter((p) => !p.wouldHit);

  const scatterData = {
    datasets: [
      {
        label: "Would hit",
        data: hits.map((p, i) => ({ x: i, y: p.score })),
        backgroundColor: "rgba(52,211,153,0.6)",
        pointRadius: 4,
      },
      {
        label: "Would miss",
        data: misses.map((p, i) => ({ x: hits.length + i, y: p.score })),
        backgroundColor: "rgba(239,68,68,0.4)",
        pointRadius: 4,
      },
    ],
  };

  const scatterOpts = {
    responsive: true,
    plugins: {
      legend: { labels: { color: "#a1a1aa" } },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"scatter">) => `score: ${(ctx.parsed.y ?? 0).toFixed(4)}`,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Request index", color: "#71717a" },
        ticks: { color: "#71717a" },
        grid: { color: "#27272a" },
      },
      y: {
        title: { display: true, text: "Similarity score", color: "#71717a" },
        ticks: { color: "#71717a" },
        grid: { color: "#27272a" },
        min: 0,
        max: 1,
      },
    },
    annotation: {},
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Cache Analysis</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Exact hit rate" value={`${(data.exactHitRate * 100).toFixed(1)}%`} accent="green" />
        <StatCard label="Exact hits" value={String(data.exactHits)} />
        <StatCard label="Total requests" value={String(data.totalRequests)} />
        <StatCard label="Cost saved" value={`$${data.savedCost.toFixed(4)}`} accent="indigo" sub="exact match" />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-400">
            Semantic similarity scores
            <span className="ml-2 text-xs text-zinc-600">(would-have-hit observation only — not served)</span>
          </p>
          <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400">
            threshold = {data.threshold}
          </span>
        </div>

        {data.semanticPoints.length === 0 ? (
          <Empty message="No semantic cache observations yet — send some requests to the gateway" />
        ) : (
          <>
            <Scatter data={scatterData} options={scatterOpts} />
            <p className="mt-3 text-xs text-zinc-600">
              {hits.length} would-have-hit · {misses.length} would-have-miss · threshold {data.threshold} ·{" "}
              Points above the threshold line = queries close enough to a cached response to potentially serve.
            </p>
          </>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400 space-y-2">
        <p className="font-medium text-zinc-300">Why threshold {data.threshold}?</p>
        <p>
          The scatter plot above shows the distribution of cosine similarity scores across all observed
          requests. The threshold was chosen by looking at the natural gap between genuinely similar
          queries and near-misses. A score above {data.threshold} reliably indicates semantic equivalence
          for the prompts seen so far; below it, the answers would meaningfully differ.
        </p>
        <p className="text-zinc-600">
          Semantic cache hits are logged but not served in v1 — the data above is the evidence base for
          deciding when to flip that on.
        </p>
      </div>
    </div>
  );
}
