import { MODEL_TIERS, TIER_ROUTING_STRATEGY } from "@promptgate/shared";
import type { Provider, Tier, TierEntry } from "@promptgate/shared";
import { getDb } from "./db";

export interface TierConfig {
  chain: readonly TierEntry[];
  strategy: "priority" | "cost_optimized";
}

const TTL_MS = 30_000;

interface CacheEntry {
  config: Record<Tier, TierConfig>;
  fetchedAt: number;
}

let _cache: CacheEntry | null = null;

function buildFromStatic(): Record<Tier, TierConfig> {
  const result = {} as Record<Tier, TierConfig>;
  for (const tier of Object.keys(MODEL_TIERS) as Tier[]) {
    result[tier] = { chain: MODEL_TIERS[tier], strategy: TIER_ROUTING_STRATEGY[tier] };
  }
  return result;
}

async function loadFromDb(): Promise<Record<Tier, TierConfig>> {
  const db = getDb();
  const rows = await db.modelTierEntry.findMany({
    where: { enabled: true },
    orderBy: [{ tier: "asc" }, { priority: "asc" }],
  });

  if (rows.length === 0) return buildFromStatic();

  const result = {} as Record<Tier, TierConfig>;
  for (const row of rows) {
    const tier = row.tier as Tier;
    if (!result[tier]) {
      result[tier] = {
        chain: [],
        strategy: (row.routing_strategy as "priority" | "cost_optimized") ?? "priority",
      };
    }
    (result[tier].chain as TierEntry[]).push({
      provider: row.provider as Provider,
      model: row.model,
      cost_per_1m_input: row.cost_per_1m_input,
      cost_per_1m_output: row.cost_per_1m_output,
    });
  }

  // Fill any tiers missing from DB with static fallback
  for (const tier of Object.keys(MODEL_TIERS) as Tier[]) {
    if (!result[tier]) result[tier] = buildFromStatic()[tier];
  }

  return result;
}

async function getAllTierConfigs(): Promise<Record<Tier, TierConfig>> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < TTL_MS) return _cache.config;

  try {
    const config = await loadFromDb();
    _cache = { config, fetchedAt: now };
    return config;
  } catch {
    if (_cache) return _cache.config; // stale beats nothing
    return buildFromStatic();
  }
}

export async function getTierConfig(tier: Tier): Promise<TierConfig> {
  const all = await getAllTierConfigs();
  return all[tier] ?? { chain: MODEL_TIERS[tier], strategy: TIER_ROUTING_STRATEGY[tier] };
}

export function invalidateTierCache(): void {
  _cache = null;
}
