import type { Provider, Tier } from "./types";

export interface TierEntry {
  provider: Provider;
  model: string;
  cost_per_1m_input: number;  // USD
  cost_per_1m_output: number; // USD
}

export const MODEL_TIERS: Record<Tier, readonly TierEntry[]> = {
  fast: [
    { provider: "groq",   model: "llama-3.3-70b-versatile",  cost_per_1m_input: 0.59,  cost_per_1m_output: 0.79 },
    { provider: "groq",   model: "openai/gpt-oss-20b",        cost_per_1m_input: 0.075, cost_per_1m_output: 0.30 },
    { provider: "openai", model: "gpt-4o-mini",               cost_per_1m_input: 0.15,  cost_per_1m_output: 0.60 },
  ],
  balanced: [
    { provider: "groq",      model: "openai/gpt-oss-120b",         cost_per_1m_input: 0.15, cost_per_1m_output: 0.60  },
    { provider: "anthropic", model: "claude-haiku-4-5-20251001",   cost_per_1m_input: 0.80, cost_per_1m_output: 4.00  },
    { provider: "openai",    model: "gpt-4o",                      cost_per_1m_input: 2.50, cost_per_1m_output: 10.00 },
  ],
  smart: [
    { provider: "nvidia",    model: "deepseek-ai/deepseek-v4-flash", cost_per_1m_input: 0.09, cost_per_1m_output: 0.18  },
    { provider: "anthropic", model: "claude-sonnet-4-6",             cost_per_1m_input: 3.00, cost_per_1m_output: 15.00 },
    { provider: "openai",    model: "gpt-4o",                        cost_per_1m_input: 2.50, cost_per_1m_output: 10.00 },
  ],
  thinking: [
    { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b", cost_per_1m_input: 0.50,  cost_per_1m_output: 2.20  },
    { provider: "nvidia", model: "deepseek-ai/deepseek-pro",          cost_per_1m_input: 0.44,  cost_per_1m_output: 0.87  },
    { provider: "anthropic", model: "claude-opus-4-8",                cost_per_1m_input: 15.00, cost_per_1m_output: 75.00 },
  ],
};

// Per-tier routing strategy. cost_optimized reorders healthy candidates by
// estimated cost before trying; priority uses chain order unchanged (v1 behavior).
export const TIER_ROUTING_STRATEGY: Record<Tier, "priority" | "cost_optimized"> = {
  fast:      "priority",
  balanced:  "priority",
  smart:     "cost_optimized",
  thinking:  "priority",
};

export type ModelTiers = typeof MODEL_TIERS;
