import { MODEL_TIERS, TIER_ROUTING_STRATEGY } from "@promptgate/shared";
import type { Provider, TierEntry, UnifiedRequest, UnifiedResponse, StreamEvent } from "@promptgate/shared";
import { randomUUID } from "crypto";
import { CircuitBreaker } from "./circuit-breaker";
import { RateLimitBackoff, RateLimitError } from "./rate-limit-backoff";
import { callAnthropic, streamAnthropic } from "./providers/anthropic";
import { callOpenAI, streamOpenAI } from "./providers/openai";
import { callGroq, streamGroq } from "./providers/groq";
import { callNvidia, streamNvidia } from "./providers/nvidia";

export type ProviderCaller = (
  unified: UnifiedRequest,
  model: string,
  requestId: string
) => Promise<UnifiedResponse>;

export type StreamCaller = (
  unified: UnifiedRequest,
  model: string,
  requestId: string
) => AsyncGenerator<StreamEvent>;

export interface FailoverRecord {
  fromProvider: Provider;
  toProvider: Provider;
  reason: "error" | "circuit_open" | "rate_limited";
  hopNumber: number;
}

export interface RouterDeps {
  breaker: CircuitBreaker;
  backoff?: RateLimitBackoff;
  callers?: Partial<Record<Provider, ProviderCaller>>;
  // Output collector: router pushes a FailoverRecord for each hop taken.
  // Caller passes an empty array; inspect it after route() resolves.
  failoverEvents?: FailoverRecord[];
}

export { RateLimitError };

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

// Primary + 2 failover hops = 3 providers tried at most.
const MAX_FAILOVER_HOPS = 2;

const DEFAULT_CALLERS: Record<Provider, ProviderCaller> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  groq: callGroq,
  nvidia: callNvidia,
};

const DEFAULT_STREAM_CALLERS: Record<Provider, StreamCaller> = {
  anthropic: streamAnthropic,
  openai: streamOpenAI,
  groq: streamGroq,
  nvidia: streamNvidia,
};

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "ForcedFailError") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("503") || msg.includes("502");
}

// Reorders healthy candidates by estimated cost (cheapest first).
// NEVER reorders a circuit-open provider ahead of a closed one — health beats cost.
async function orderedCandidates(
  chain: readonly TierEntry[],
  tier: UnifiedRequest["tier"],
  breaker: CircuitBreaker,
  backoff: RateLimitBackoff | undefined,
  estimatedMaxTokens: number
): Promise<TierEntry[]> {
  const strategy = TIER_ROUTING_STRATEGY[tier];
  const capped = chain.slice(0, MAX_FAILOVER_HOPS + 1);

  if (strategy === "priority") return [...capped];

  // cost_optimized: filter to healthy candidates, sort by estimated cost
  const healthChecks = await Promise.all(
    capped.map(async (e) => ({
      entry: e,
      state: await breaker.effectiveState(e.provider),
      blocked: backoff ? await backoff.isBlocked(e.provider) : false,
    }))
  );

  const healthy = healthChecks.filter((h) => h.state !== "open" && !h.blocked);
  const unhealthy = healthChecks.filter((h) => h.state === "open" || h.blocked);

  const sortedHealthy = healthy
    .slice()
    .sort((a, b) => {
      // Use max_tokens as output estimate; input is unknowable pre-call so
      // we use a 1:1 input:output ratio heuristic — good enough for ordering.
      const costA =
        (estimatedMaxTokens / 1_000_000) * (a.entry.cost_per_1m_input + a.entry.cost_per_1m_output);
      const costB =
        (estimatedMaxTokens / 1_000_000) * (b.entry.cost_per_1m_input + b.entry.cost_per_1m_output);
      return costA - costB;
    });

  // Healthy (cost-sorted) first, then unhealthy (preserves ordering so circuit-open
  // providers are still skipped correctly in the main loop).
  return [...sortedHealthy, ...unhealthy].map((h) => h.entry);
}

export async function route(
  unified: UnifiedRequest,
  deps: RouterDeps,
  requestId: string = randomUUID()
): Promise<UnifiedResponse> {
  const rawChain = MODEL_TIERS[unified.tier];
  const callers = { ...DEFAULT_CALLERS, ...deps.callers };

  const chain = await orderedCandidates(
    rawChain,
    unified.tier,
    deps.breaker,
    deps.backoff,
    unified.max_tokens
  );

  let failoverOccurred = false;
  let firstError: unknown;
  let hopNumber = 0;
  let lastProvider: Provider | null = null;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    const call = callers[provider];

    const state = await deps.breaker.effectiveState(provider);
    if (state === "open") {
      if (i < chain.length - 1) {
        failoverOccurred = true;
        if (lastProvider !== null) {
          deps.failoverEvents?.push({
            fromProvider: lastProvider,
            toProvider: chain[i + 1]?.provider ?? provider,
            reason: "circuit_open",
            hopNumber: ++hopNumber,
          });
        }
      }
      lastProvider = provider;
      continue;
    }

    if (deps.backoff && (await deps.backoff.isBlocked(provider))) {
      if (i < chain.length - 1) {
        failoverOccurred = true;
        if (lastProvider !== null) {
          deps.failoverEvents?.push({
            fromProvider: lastProvider,
            toProvider: chain[i + 1]?.provider ?? provider,
            reason: "rate_limited",
            hopNumber: ++hopNumber,
          });
        }
      }
      lastProvider = provider;
      continue;
    }

    try {
      const response = await call(unified, model, requestId);

      if (state === "half-open") await deps.breaker.recordSuccess(provider);
      if (deps.backoff) await deps.backoff.recordSuccess(provider);

      return { ...response, failover_occurred: failoverOccurred };
    } catch (err) {
      firstError ??= err;

      if (err instanceof RateLimitError) {
        if (deps.backoff) await deps.backoff.recordRateLimit(provider, err.retryAfterMs);
      } else if (isRetryable(err)) {
        await deps.breaker.recordFailure(provider);
      }

      if (i < chain.length - 1) {
        failoverOccurred = true;
        deps.failoverEvents?.push({
          fromProvider: provider,
          toProvider: chain[i + 1].provider,
          reason: "error",
          hopNumber: ++hopNumber,
        });
      }
      lastProvider = provider;
    }
  }

  throw new RouterError(
    `All providers exhausted for tier "${unified.tier}": ${String(firstError)}`
  );
}

// routeStream: failover is only possible before the first chunk.
// After first chunk, mid-stream errors propagate as SSE error events — no retry.
export async function* routeStream(
  unified: UnifiedRequest,
  deps: RouterDeps,
  requestId: string = randomUUID()
): AsyncGenerator<StreamEvent> {
  const rawChain = MODEL_TIERS[unified.tier];
  const streamCallers: Record<Provider, StreamCaller> = { ...DEFAULT_STREAM_CALLERS };

  const chain = await orderedCandidates(
    rawChain,
    unified.tier,
    deps.breaker,
    deps.backoff,
    unified.max_tokens
  );

  let failoverOccurred = false;
  let firstError: unknown;
  let hopNumber = 0;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];

    const state = await deps.breaker.effectiveState(provider);
    if (state === "open") {
      if (i < chain.length - 1) {
        failoverOccurred = true;
        deps.failoverEvents?.push({
          fromProvider: provider,
          toProvider: chain[i + 1].provider,
          reason: "circuit_open",
          hopNumber: ++hopNumber,
        });
      }
      continue;
    }

    if (deps.backoff && (await deps.backoff.isBlocked(provider))) {
      if (i < chain.length - 1) {
        failoverOccurred = true;
        deps.failoverEvents?.push({
          fromProvider: provider,
          toProvider: chain[i + 1].provider,
          reason: "rate_limited",
          hopNumber: ++hopNumber,
        });
      }
      continue;
    }

    const gen = streamCallers[provider](unified, model, requestId);

    try {
      const first = await gen.next();
      if (first.done) continue;

      // First chunk received — committed to this provider, no more failover possible
      if (first.value.type === "done") {
        yield { ...first.value, failover_occurred: failoverOccurred };
      } else {
        yield first.value;
      }

      for await (const event of gen) {
        if (event.type === "done") {
          yield { ...event, failover_occurred: failoverOccurred };
        } else {
          yield event;
        }
      }

      if (state === "half-open") await deps.breaker.recordSuccess(provider);
      return;
    } catch (err) {
      firstError ??= err;

      if (err instanceof RateLimitError) {
        if (deps.backoff) await deps.backoff.recordRateLimit(provider, err.retryAfterMs);
      } else if (isRetryable(err)) {
        await deps.breaker.recordFailure(provider);
      }

      if (i < chain.length - 1) {
        failoverOccurred = true;
        deps.failoverEvents?.push({
          fromProvider: provider,
          toProvider: chain[i + 1].provider,
          reason: "error",
          hopNumber: ++hopNumber,
        });
      }
    }
  }

  throw new RouterError(
    `All providers exhausted for tier "${unified.tier}": ${String(firstError)}`
  );
}
