import type { Provider, Tier } from "./types";

export interface TierEntry {
  provider: Provider;
  model: string;
}

export const MODEL_TIERS = {
  fast: [
    { provider: "groq" as const, model: "llama-3.3-70b-versatile" },
    { provider: "openai" as const, model: "gpt-4o-mini" },
  ],
  balanced: [
    { provider: "openai" as const, model: "gpt-4o" },
    { provider: "anthropic" as const, model: "claude-sonnet-4-6" },
  ],
  smart: [
    { provider: "anthropic" as const, model: "claude-opus-4-8" },
    { provider: "openai" as const, model: "gpt-4o" },
  ],
} as const satisfies Record<Tier, readonly TierEntry[]>;

export type ModelTiers = typeof MODEL_TIERS;
