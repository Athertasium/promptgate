"use client";

import { useEffect, useState, useCallback } from "react";

type TierEntry = {
  id: string;
  tier: string;
  provider: string;
  model: string;
  priority: number;
  enabled: boolean;
  cost_per_1m_input: number;
  cost_per_1m_output: number;
  routing_strategy: string;
};

const TIER_ORDER = ["fast", "balanced", "smart", "thinking"];

export default function TiersPage() {
  const [entries, setEntries] = useState<TierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/tiers")
      .then((r) => r.json())
      .then((data: TierEntry[]) => { setEntries(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleEnabled(id: string, enabled: boolean) {
    await fetch(`/api/tiers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, enabled } : e));
  }

  async function movePriority(id: string, direction: -1 | 1) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;

    const tierEntries = entries
      .filter((e) => e.tier === entry.tier)
      .sort((a, b) => a.priority - b.priority);

    const idx = tierEntries.findIndex((e) => e.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= tierEntries.length) return;

    const swapEntry = tierEntries[swapIdx];
    const newPriority = swapEntry.priority;
    const swapPriority = entry.priority;

    await Promise.all([
      fetch(`/api/tiers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      }),
      fetch(`/api/tiers/${swapEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: swapPriority }),
      }),
    ]);

    setEntries((prev) =>
      prev.map((e) => {
        if (e.id === id) return { ...e, priority: newPriority };
        if (e.id === swapEntry.id) return { ...e, priority: swapPriority };
        return e;
      })
    );
  }

  async function toggleStrategy(tier: string) {
    const tierEntries = entries.filter((e) => e.tier === tier);
    if (tierEntries.length === 0) return;

    const current = tierEntries[0].routing_strategy;
    const next = current === "priority" ? "cost_optimized" : "priority";

    await Promise.all(
      tierEntries.map((e) =>
        fetch(`/api/tiers/${e.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routing_strategy: next }),
        })
      )
    );

    setEntries((prev) =>
      prev.map((e) => (e.tier === tier ? { ...e, routing_strategy: next } : e))
    );
  }

  async function forceReload() {
    setReloading(true);
    await fetch("/api/tiers", { method: "POST" });
    setReloading(false);
  }

  if (error) return <p className="text-rose-400">Failed to load tiers.</p>;
  if (loading) return <p className="text-zinc-500">Loading…</p>;

  const byTier = TIER_ORDER.map((tier) => ({
    tier,
    entries: entries
      .filter((e) => e.tier === tier)
      .sort((a, b) => a.priority - b.priority),
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Model Tiers</h1>
        <button
          onClick={forceReload}
          disabled={reloading}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {reloading ? "Reloading…" : "Reload cache now"}
        </button>
      </div>

      <p className="text-sm text-zinc-500">
        Changes take effect within 30 s (in-process cache TTL) or immediately after "Reload cache now".
      </p>

      <div className="space-y-6">
        {byTier.map(({ tier, entries: te }) => {
          const strategy = te[0]?.routing_strategy ?? "priority";
          return (
            <div key={tier} className="rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
                <span className="font-medium capitalize">{tier}</span>
                <button
                  onClick={() => toggleStrategy(tier)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    strategy === "cost_optimized"
                      ? "bg-green-900/50 text-green-400 hover:bg-green-900"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {strategy === "cost_optimized" ? "cost optimized" : "priority order"}
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="px-5 py-2">Priority</th>
                    <th className="px-5 py-2">Provider</th>
                    <th className="px-5 py-2">Model</th>
                    <th className="px-5 py-2">$/1M in</th>
                    <th className="px-5 py-2">$/1M out</th>
                    <th className="px-5 py-2">Enabled</th>
                    <th className="px-5 py-2">Reorder</th>
                  </tr>
                </thead>
                <tbody>
                  {te.map((e, idx) => (
                    <tr
                      key={e.id}
                      className={`border-b border-zinc-800/50 last:border-0 ${
                        !e.enabled ? "opacity-40" : ""
                      }`}
                    >
                      <td className="px-5 py-2.5 text-zinc-500">{e.priority}</td>
                      <td className="px-5 py-2.5 text-zinc-300">{e.provider}</td>
                      <td className="px-5 py-2.5 font-mono text-xs text-zinc-400">{e.model}</td>
                      <td className="px-5 py-2.5 text-zinc-400">${e.cost_per_1m_input}</td>
                      <td className="px-5 py-2.5 text-zinc-400">${e.cost_per_1m_output}</td>
                      <td className="px-5 py-2.5">
                        <button
                          onClick={() => toggleEnabled(e.id, !e.enabled)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            e.enabled ? "bg-indigo-600" : "bg-zinc-700"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              e.enabled ? "translate-x-4" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-5 py-2.5">
                        <span className="flex gap-1">
                          <button
                            onClick={() => movePriority(e.id, -1)}
                            disabled={idx === 0}
                            className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => movePriority(e.id, 1)}
                            disabled={idx === te.length - 1}
                            className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-20 transition-colors"
                          >
                            ↓
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
