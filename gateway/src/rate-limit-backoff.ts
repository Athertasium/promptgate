import type { Provider } from "@promptgate/shared";
import type { RedisLike } from "./circuit-breaker.js";
import type { CircuitBreaker } from "./circuit-breaker.js";

const ESCALATION_THRESHOLD = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

interface BackoffState {
  backoff_until: number;
  consecutive_429s: number;
}

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs?: number,
    message = "Rate limited by provider"
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

function backoffKey(provider: Provider): string {
  return `ratelimit_backoff:${provider}`;
}

export class RateLimitBackoff {
  constructor(
    private readonly redis: RedisLike,
    private readonly breaker: CircuitBreaker,
    private readonly now: () => number = Date.now
  ) {}

  async isBlocked(provider: Provider): Promise<boolean> {
    const raw = await this.redis.get(backoffKey(provider));
    if (!raw) return false;
    const state = JSON.parse(raw) as BackoffState;
    return this.now() < state.backoff_until;
  }

  async getState(provider: Provider): Promise<BackoffState> {
    const raw = await this.redis.get(backoffKey(provider));
    if (!raw) return { backoff_until: 0, consecutive_429s: 0 };
    return JSON.parse(raw) as BackoffState;
  }

  async recordRateLimit(provider: Provider, retryAfterMs?: number): Promise<void> {
    const prev = await this.getState(provider);
    const consecutive = prev.consecutive_429s + 1;
    const delay =
      retryAfterMs ??
      Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutive - 1), MAX_BACKOFF_MS);
    const backoff_until = this.now() + delay;

    await this.redis.set(
      backoffKey(provider),
      JSON.stringify({ backoff_until, consecutive_429s: consecutive })
    );

    // ponytail: escalate to circuit-open at threshold; 429 and 5xx are separate
    // state machines that can converge — documented in v2.md §3
    if (consecutive >= ESCALATION_THRESHOLD) {
      await this.breaker.forceOpen(provider);
    }
  }

  async recordSuccess(provider: Provider): Promise<void> {
    await this.redis.set(
      backoffKey(provider),
      JSON.stringify({ backoff_until: 0, consecutive_429s: 0 })
    );
  }
}
