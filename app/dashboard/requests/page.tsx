"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  created_at: string;
  tier: string;
  served_by_provider: string | null;
  served_by_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  latency_ms: number | null;
  cache_hit: boolean;
  failover_occurred: boolean;
  caller_id: string | null;
};

type PageData = { rows: Row[]; total: number; page: number; pages: number };

const TIERS = ["fast", "balanced", "smart"];
const PROVIDERS = ["anthropic", "openai", "groq"];

function Badge({ on, label, color }: { on: boolean; label: string; color: string }) {
  if (!on) return <span className="text-zinc-700">—</span>;
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
}

export default function RequestsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [tier, setTier] = useState("");
  const [provider, setProvider] = useState("");
  const [cacheHit, setCacheHit] = useState("");
  const [failover, setFailover] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (tier) params.set("tier", tier);
    if (provider) params.set("provider", provider);
    if (cacheHit) params.set("cache_hit", cacheHit);
    if (failover) params.set("failover", failover);
    fetch(`/api/requests?${params}`)
      .then((r) => r.json())
      .then(setData);
  }, [page, tier, provider, cacheHit, failover]);

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Request Log</h1>

      <div className="flex flex-wrap gap-3">
        <select
          value={tier}
          onChange={(e) => { setTier(e.target.value); resetPage(); }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={provider}
          onChange={(e) => { setProvider(e.target.value); resetPage(); }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All providers</option>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={cacheHit}
          onChange={(e) => { setCacheHit(e.target.value); resetPage(); }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Cache: any</option>
          <option value="true">Cache hit</option>
          <option value="false">Cache miss</option>
        </select>
        <select
          value={failover}
          onChange={(e) => { setFailover(e.target.value); resetPage(); }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Failover: any</option>
          <option value="true">Failover occurred</option>
          <option value="false">No failover</option>
        </select>
        {data && (
          <span className="ml-auto self-center text-xs text-zinc-500">
            {data.total.toLocaleString()} rows
          </span>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              {["Time", "Tier", "Provider / Model", "Tokens in/out", "Cost", "Latency", "Cache", "Failover"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-600">Loading…</td></tr>
            )}
            {data?.rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-600">No requests yet</td></tr>
            )}
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{r.tier}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-zinc-300">
                  {r.served_by_provider ?? "—"}
                  {r.served_by_model && (
                    <span className="ml-1 text-zinc-600">({r.served_by_model})</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-zinc-400">
                  {r.input_tokens ?? "—"} / {r.output_tokens ?? "—"}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-zinc-300">
                  ${r.cost_usd.toFixed(5)}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-zinc-400">
                  {r.latency_ms != null ? `${r.latency_ms}ms` : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <Badge on={r.cache_hit} label="hit" color="bg-emerald-900/60 text-emerald-300" />
                </td>
                <td className="px-4 py-2.5">
                  <Badge on={r.failover_occurred} label="yes" color="bg-orange-900/60 text-orange-300" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-zinc-500">{page} / {data.pages}</span>
          <button
            disabled={page === data.pages}
            onClick={() => setPage(page + 1)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
