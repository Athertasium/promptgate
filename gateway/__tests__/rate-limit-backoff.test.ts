import { describe, it, expect, beforeEach } from "vitest";
import { RateLimitBackoff, RateLimitError } from "../src/rate-limit-backoff";
import { CircuitBreaker } from "../src/circuit-breaker";
import type { RedisLike } from "../src/circuit-breaker";
import { route, RouterError } from "../src/router";
import type { ProviderCaller } from "../src/router";
import type { UnifiedRequest, UnifiedResponse } from "@promptgate/shared";

// ── shared fakes ────────────────────────────────────────────────────────────

class FakeRedis implements RedisLike {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
}

function makeResponse(provider: string, model: string): UnifiedResponse {
  return {
    content: `response from ${provider}`,
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 },
    served_by: { provider: provider as never, model },
    failover_occurred: false,
    cache_hit: false,
    latency_ms: 50,
    request_id: "test-id",
  };
}

function successCaller(provider: string, model: string): ProviderCaller {
  return async (_req, _model, requestId) => ({ ...makeResponse(provider, model), request_id: requestId });
}

function rateLimitCaller(retryAfterMs?: number): ProviderCaller {
  return async () => { throw new RateLimitError(retryAfterMs); };
}

function failCaller(): ProviderCaller {
  return async () => {
    const err = new Error("FORCE_FAIL: forced 5xx");
    err.name = "ForcedFailError";
    throw err;
  };
}

const baseRequest: UnifiedRequest = {
  tier: "balanced", // chain: groq(openai/gpt-oss-120b) → anthropic(claude-haiku-4-5-20251001)
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 100,
  stream: false,
};

let redis: FakeRedis;
let now: number;
let breaker: CircuitBreaker;
let backoff: RateLimitBackoff;

beforeEach(() => {
  redis = new FakeRedis();
  now = 1_000_000;
  breaker = new CircuitBreaker(redis, () => now);
  backoff = new RateLimitBackoff(redis, breaker, () => now);
});

// ── RateLimitBackoff unit tests ──────────────────────────────────────────────

describe("RateLimitBackoff.isBlocked", () => {
  it("returns false when no state stored", async () => {
    expect(await backoff.isBlocked("openai")).toBe(false);
  });

  it("returns true while within backoff window", async () => {
    await backoff.recordRateLimit("openai");
    expect(await backoff.isBlocked("openai")).toBe(true);
  });

  it("returns false after backoff window expires", async () => {
    await backoff.recordRateLimit("openai"); // 2s backoff on first 429
    now += 3_000;
    expect(await backoff.isBlocked("openai")).toBe(false);
  });
});

describe("RateLimitBackoff.recordRateLimit", () => {
  it("uses Retry-After ms when provided", async () => {
    await backoff.recordRateLimit("openai", 10_000);
    const state = await backoff.getState("openai");
    expect(state.backoff_until).toBe(now + 10_000);
    expect(state.consecutive_429s).toBe(1);
  });

  it("exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)", async () => {
    const delays: number[] = [];
    let prevTime = now;
    for (let i = 0; i < 6; i++) {
      await backoff.recordRateLimit("openai");
      const state = await backoff.getState("openai");
      delays.push(state.backoff_until - prevTime);
      prevTime = now;
    }
    expect(delays[0]).toBe(2_000);
    expect(delays[1]).toBe(4_000);
    expect(delays[2]).toBe(8_000);
    expect(delays[3]).toBe(16_000);
    expect(delays[4]).toBe(32_000);
    expect(delays[5]).toBe(60_000); // capped
  });

  it("increments consecutive_429s on each call", async () => {
    await backoff.recordRateLimit("openai");
    await backoff.recordRateLimit("openai");
    const state = await backoff.getState("openai");
    expect(state.consecutive_429s).toBe(2);
  });
});

describe("RateLimitBackoff.recordSuccess", () => {
  it("clears backoff after success", async () => {
    await backoff.recordRateLimit("openai");
    await backoff.recordSuccess("openai");
    expect(await backoff.isBlocked("openai")).toBe(false);
    const state = await backoff.getState("openai");
    expect(state.consecutive_429s).toBe(0);
  });
});

describe("escalation to circuit-open at 5 consecutive 429s", () => {
  it("forces circuit open after 5 429s", async () => {
    for (let i = 0; i < 5; i++) {
      await backoff.recordRateLimit("openai");
    }
    const circuitState = await breaker.effectiveState("openai");
    expect(circuitState).toBe("open");
  });

  it("does NOT open circuit before threshold", async () => {
    for (let i = 0; i < 4; i++) {
      await backoff.recordRateLimit("openai");
    }
    const circuitState = await breaker.effectiveState("openai");
    expect(circuitState).toBe("closed");
  });

  it("circuit-open escalation does not increment 5xx failure_count", async () => {
    for (let i = 0; i < 5; i++) {
      await backoff.recordRateLimit("openai");
    }
    const status = await breaker.getStatus("openai");
    // forceOpen sets state directly, failure_count stays at circuit-breaker's own count (0)
    expect(status.failure_count).toBe(0);
  });
});

// ── router integration ───────────────────────────────────────────────────────

describe("router: 429 does not increment circuit-breaker failure_count", () => {
  it("records rate limit but leaves circuit closed", async () => {
    await route(baseRequest, {
      breaker,
      backoff,
      callers: {
        groq: rateLimitCaller(),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });
    const status = await breaker.getStatus("groq");
    expect(status.failure_count).toBe(0);
    expect(status.state).toBe("closed");
  });
});

describe("router: 429 backoff causes provider skip", () => {
  it("skips backoff-blocked provider and falls over to next", async () => {
    // Put groq in backoff
    await backoff.recordRateLimit("groq");
    let groqCalled = false;

    const result = await route(baseRequest, {
      breaker,
      backoff,
      callers: {
        groq: async () => { groqCalled = true; return makeResponse("groq", "openai/gpt-oss-120b"); },
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });

    expect(groqCalled).toBe(false);
    expect(result.served_by.provider).toBe("anthropic");
    expect(result.failover_occurred).toBe(true);
  });

  it("uses rate-limited provider once backoff expires", async () => {
    await backoff.recordRateLimit("groq"); // 2s backoff
    now += 3_000; // advance past backoff

    const result = await route(baseRequest, {
      breaker,
      backoff,
      callers: {
        groq: successCaller("groq", "openai/gpt-oss-120b"),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });

    expect(result.served_by.provider).toBe("groq");
    expect(result.failover_occurred).toBe(false);
  });
});

describe("router: success clears backoff", () => {
  it("resets consecutive_429s after successful call", async () => {
    await backoff.recordRateLimit("groq");
    now += 3_000; // let backoff expire so groq is tried again

    await route(baseRequest, {
      breaker,
      backoff,
      callers: { groq: successCaller("groq", "openai/gpt-oss-120b") },
    });

    const state = await backoff.getState("groq");
    expect(state.consecutive_429s).toBe(0);
  });
});

describe("router: 429 with Retry-After header", () => {
  it("respects retryAfterMs from RateLimitError", async () => {
    await route(baseRequest, {
      breaker,
      backoff,
      callers: {
        groq: rateLimitCaller(30_000), // 30s Retry-After
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });

    const state = await backoff.getState("groq");
    expect(state.backoff_until).toBe(now + 30_000);
  });
});

describe("router: 429 and 5xx are distinct; 5xx does not clear 429 counter", () => {
  it("5xx failure does not increment 429 consecutive counter", async () => {
    // One 429 first
    await route(baseRequest, {
      breaker,
      backoff,
      callers: {
        groq: rateLimitCaller(),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });

    now += 3_000; // expire backoff

    // Now a 5xx — should record circuit failure, not touch 429 state
    await route(baseRequest, {
      breaker,
      backoff,
      callers: {
        groq: failCaller(),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });

    const cbStatus = await breaker.getStatus("groq");
    expect(cbStatus.failure_count).toBe(1); // circuit breaker got the 5xx

    const backoffState = await backoff.getState("groq");
    expect(backoffState.consecutive_429s).toBe(1); // still at 1 from earlier, not incremented
  });
});

describe("router: no backoff dep = backward compatible", () => {
  it("routes normally without backoff dep", async () => {
    const result = await route(baseRequest, {
      breaker,
      callers: { groq: successCaller("groq", "openai/gpt-oss-120b") },
    });
    expect(result.served_by.provider).toBe("groq");
  });
});
