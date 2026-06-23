import type { Provider, Tier } from "./types";

export interface TierEntry {
  provider: Provider;
  model: string;
}

export const MODEL_TIERS = {
  fast: [
    { provider: "groq" as const, model: "llama-3.3-70b-versatile" },
    { provider: "groq" as const, model: "openai/gpt-oss-20b" },// 0.075 input , 0.30 output     
  ],
  balanced: [
    { provider: "groq" as const, model: "openai/gpt-oss-120b" },// 0.15 input , 0.60 output
    { provider: "anthropic" as const, model: "claude-haiku-4-5-20251001" },// 1.00 input , 5.00 output
  ],
  smart: [
    { provider: "nvidia" as const, model: "deepseek-ai/deepseek-v4-flash" },
    { provider: "anthropic" as const, model: "claude-sonnet-4-6" },// sonnet 3.00 input , 15.00 output
  ],
  thinking: [
    { provider: "nvidia" as const, model: "nvidia/nemotron-3-ultra-550b-a55b" },
    { provider: "nvidia" as const, model: "deepseek-ai/deepseek-pro" },
  ],
} as const satisfies Record<Tier, readonly TierEntry[]>;

export type ModelTiers = typeof MODEL_TIERS;
