import { MODEL_TIERS } from "@promptgate/shared";
import type { Provider, UnifiedRequest, UnifiedResponse } from "@promptgate/shared";
import { randomUUID } from "crypto";
import { CircuitBreaker } from "./circuit-breaker";
import { callAnthropic } from "./providers/anthropic";
import { callOpenAI } from "./providers/openai";
import { callGroq } from "./providers/groq";

export type ProviderCaller = (
  unified: UnifiedRequest,
  model: string,
  requestId: string
) => Promise<UnifiedResponse>;

export interface RouterDeps {
  breaker: CircuitBreaker;
  // Injected for testing; defaults to real SDK callers
  callers?: Partial<Record<Provider, ProviderCaller>>;
}

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

const DEFAULT_CALLERS: Record<Provider, ProviderCaller> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  groq: callGroq,
};

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // ForcedFailError from any adapter simulates a retryable 5xx
  if (err.name === "ForcedFailError") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("503") || msg.includes("502");
}

export async function route(
  unified: UnifiedRequest,
  deps: RouterDeps,
  requestId = randomUUID()
): Promise<UnifiedResponse> {
  const chain = MODEL_TIERS[unified.tier];
  const callers = { ...DEFAULT_CALLERS, ...deps.callers };

  let failoverOccurred = false;
  let firstError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    const call = callers[provider];

    const state = await deps.breaker.effectiveState(provider);
    if (state === "open") {
      // circuit open — skip immediately, count as failover if more remain
      if (i < chain.length - 1) failoverOccurred = true;
      continue;
    }

    try {
      const response = await call(unified, model, requestId);

      if (state === "half-open") {
        await deps.breaker.recordSuccess(provider);
      }

      return { ...response, failover_occurred: failoverOccurred };
    } catch (err) {
      firstError ??= err;

      if (isRetryable(err)) {
        await deps.breaker.recordFailure(provider);
      }

      if (i < chain.length - 1) failoverOccurred = true;
    }
  }

  throw new RouterError(
    `All providers exhausted for tier "${unified.tier}": ${String(firstError)}`
  );
}
