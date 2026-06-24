import { MODEL_TIERS } from "@promptgate/shared";
import type { Provider, UnifiedRequest, UnifiedResponse, StreamEvent } from "@promptgate/shared";
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

export interface RouterDeps {
  breaker: CircuitBreaker;
  backoff?: RateLimitBackoff;
  // Injected for testing; defaults to real SDK callers
  callers?: Partial<Record<Provider, ProviderCaller>>;
}

export { RateLimitError };

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
  // ForcedFailError from any adapter simulates a retryable 5xx
  if (err.name === "ForcedFailError") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("503") || msg.includes("502");
}

export async function route(
  unified: UnifiedRequest,
  deps: RouterDeps,
  requestId: string = randomUUID()
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
      if (i < chain.length - 1) failoverOccurred = true;
      continue;
    }

    // 429 backoff check — separate from circuit breaker, does not count as 5xx
    if (deps.backoff && (await deps.backoff.isBlocked(provider))) {
      if (i < chain.length - 1) failoverOccurred = true;
      continue;
    }

    try {
      const response = await call(unified, model, requestId);

      if (state === "half-open") {
        await deps.breaker.recordSuccess(provider);
      }
      if (deps.backoff) {
        await deps.backoff.recordSuccess(provider);
      }

      return { ...response, failover_occurred: failoverOccurred };
    } catch (err) {
      firstError ??= err;

      if (err instanceof RateLimitError) {
        // 429 — track separately; never increments circuit-breaker failure_count
        if (deps.backoff) {
          await deps.backoff.recordRateLimit(provider, err.retryAfterMs);
        }
      } else if (isRetryable(err)) {
        await deps.breaker.recordFailure(provider);
      }

      if (i < chain.length - 1) failoverOccurred = true;
    }
  }

  throw new RouterError(
    `All providers exhausted for tier "${unified.tier}": ${String(firstError)}`
  );
}

// routeStream: failover is only possible before the first chunk arrives.
// Once streaming starts, errors propagate through the SSE stream.
export async function* routeStream(
  unified: UnifiedRequest,
  deps: RouterDeps,
  requestId: string = randomUUID()
): AsyncGenerator<StreamEvent> {
  const chain = MODEL_TIERS[unified.tier];
  const streamCallers: Record<Provider, StreamCaller> = { ...DEFAULT_STREAM_CALLERS };

  let failoverOccurred = false;
  let firstError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];

    const state = await deps.breaker.effectiveState(provider);
    if (state === "open") {
      if (i < chain.length - 1) failoverOccurred = true;
      continue;
    }

    if (deps.backoff && (await deps.backoff.isBlocked(provider))) {
      if (i < chain.length - 1) failoverOccurred = true;
      continue;
    }

    const gen = streamCallers[provider](unified, model, requestId);

    try {
      // Peek first event — if this throws, we can still failover
      const first = await gen.next();
      if (first.done) continue;

      // First chunk received — committed to this provider
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

      if (state === "half-open") {
        await deps.breaker.recordSuccess(provider);
      }
      return;
    } catch (err) {
      firstError ??= err;

      if (err instanceof RateLimitError) {
        if (deps.backoff) await deps.backoff.recordRateLimit(provider, err.retryAfterMs);
      } else if (isRetryable(err)) {
        await deps.breaker.recordFailure(provider);
      }

      if (i < chain.length - 1) failoverOccurred = true;
    }
  }

  throw new RouterError(
    `All providers exhausted for tier "${unified.tier}": ${String(firstError)}`
  );
}
