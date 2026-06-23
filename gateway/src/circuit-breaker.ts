import type { Provider } from "@promptgate/shared";

const FAILURE_THRESHOLD = 3;     // consecutive failures within window to open
const WINDOW_MS = 60_000;        // 60s window for counting failures
const OPEN_DURATION_MS = 30_000; // 30s before transitioning open → half-open

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitStatus {
  state: CircuitState;
  failure_count: number;
  opened_at: number | null;
  last_failure_at: number | null;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

const DEFAULT_STATUS: CircuitStatus = {
  state: "closed",
  failure_count: 0,
  opened_at: null,
  last_failure_at: null,
};

function redisKey(provider: Provider): string {
  return `circuit:${provider}`;
}

export class CircuitBreaker {
  constructor(
    private readonly redis: RedisLike,
    private readonly now: () => number = Date.now
  ) {}

  async getStatus(provider: Provider): Promise<CircuitStatus> {
    const raw = await this.redis.get(redisKey(provider));
    if (!raw) return { ...DEFAULT_STATUS };
    return JSON.parse(raw) as CircuitStatus;
  }

  private async save(provider: Provider, status: CircuitStatus): Promise<void> {
    await this.redis.set(redisKey(provider), JSON.stringify(status));
  }

  // Returns effective state, applying the open → half-open time transition in place.
  async effectiveState(provider: Provider): Promise<CircuitState> {
    const status = await this.getStatus(provider);

    if (status.state === "open" && status.opened_at !== null) {
      if (this.now() - status.opened_at >= OPEN_DURATION_MS) {
        await this.save(provider, { ...status, state: "half-open" });
        return "half-open";
      }
    }

    return status.state;
  }

  async recordFailure(provider: Provider): Promise<void> {
    const status = await this.getStatus(provider);
    const now = this.now();

    // Reset consecutive count when the gap exceeds the window.
    const withinWindow =
      status.last_failure_at !== null &&
      now - status.last_failure_at < WINDOW_MS;

    const newCount = withinWindow ? status.failure_count + 1 : 1;
    const shouldOpen = newCount >= FAILURE_THRESHOLD;

    await this.save(provider, {
      state: shouldOpen ? "open" : "closed",
      failure_count: newCount,
      opened_at: shouldOpen ? now : null,
      last_failure_at: now,
    });
  }

  async recordSuccess(provider: Provider): Promise<void> {
    await this.save(provider, { ...DEFAULT_STATUS });
  }
}
