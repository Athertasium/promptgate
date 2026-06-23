import { describe, it, expect, beforeEach } from "vitest";
import { route, RouterError } from "../src/router";
import { CircuitBreaker } from "../src/circuit-breaker";
import type { RedisLike } from "../src/circuit-breaker";
import type { UnifiedRequest, UnifiedResponse } from "@promptgate/shared";
import type { ProviderCaller } from "../src/router";

// ── helpers ────────────────────────────────────────────────────────────────

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

function failCaller(): ProviderCaller {
  return async () => {
    const err = new Error("FORCE_FAIL: forced 5xx");
    err.name = "ForcedFailError";
    throw err;
  };
}

const baseRequest: UnifiedRequest = {
  tier: "balanced", // chain: openai(gpt-4o) → anthropic(claude-sonnet-4-6)
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 100,
  stream: false,
};

let redis: FakeRedis;
let now: number;
let breaker: CircuitBreaker;

beforeEach(() => {
  redis = new FakeRedis();
  now = 1_000_000;
  breaker = new CircuitBreaker(redis, () => now);
});

// ── routing ────────────────────────────────────────────────────────────────

describe("normal routing", () => {
  it("routes to first provider in chain", async () => {
    const result = await route(baseRequest, {
      breaker,
      callers: {
        openai: successCaller("openai", "gpt-4o"),
        anthropic: successCaller("anthropic", "claude-sonnet-4-6"),
      },
    });
    expect(result.served_by.provider).toBe("openai");
    expect(result.failover_occurred).toBe(false);
  });

  it("passes request_id through", async () => {
    const result = await route(
      baseRequest,
      { breaker, callers: { openai: successCaller("openai", "gpt-4o") } },
      "fixed-id"
    );
    expect(result.request_id).toBe("fixed-id");
  });
});

// ── failover ───────────────────────────────────────────────────────────────

describe("failover on provider error", () => {
  it("falls over to second provider when first throws ForcedFailError", async () => {
    const result = await route(baseRequest, {
      breaker,
      callers: {
        openai: failCaller(),
        anthropic: successCaller("anthropic", "claude-sonnet-4-6"),
      },
    });
    expect(result.served_by.provider).toBe("anthropic");
    expect(result.failover_occurred).toBe(true);
  });

  it("records failure on first provider after failover", async () => {
    await route(baseRequest, {
      breaker,
      callers: {
        openai: failCaller(),
        anthropic: successCaller("anthropic", "claude-sonnet-4-6"),
      },
    });
    const status = await breaker.getStatus("openai");
    expect(status.failure_count).toBe(1);
  });

  it("throws RouterError when all providers fail", async () => {
    await expect(
      route(baseRequest, {
        breaker,
        callers: {
          openai: failCaller(),
          anthropic: failCaller(),
        },
      })
    ).rejects.toBeInstanceOf(RouterError);
  });
});

// ── circuit breaker integration ────────────────────────────────────────────

describe("circuit breaker: open circuit skips provider", () => {
  it("skips open provider and routes to next without calling it", async () => {
    let openaiCalled = false;

    // open openai circuit
    await breaker.recordFailure("openai");
    await breaker.recordFailure("openai");
    await breaker.recordFailure("openai");

    const result = await route(baseRequest, {
      breaker,
      callers: {
        openai: async () => { openaiCalled = true; return makeResponse("openai", "gpt-4o"); },
        anthropic: successCaller("anthropic", "claude-sonnet-4-6"),
      },
    });

    expect(openaiCalled).toBe(false);
    expect(result.served_by.provider).toBe("anthropic");
    expect(result.failover_occurred).toBe(true);
  });

  it("throws RouterError when all circuits open", async () => {
    await breaker.recordFailure("openai");
    await breaker.recordFailure("openai");
    await breaker.recordFailure("openai");
    await breaker.recordFailure("anthropic");
    await breaker.recordFailure("anthropic");
    await breaker.recordFailure("anthropic");

    await expect(
      route(baseRequest, { breaker })
    ).rejects.toBeInstanceOf(RouterError);
  });
});

describe("circuit breaker: half-open success closes circuit", () => {
  it("closes circuit after successful half-open request", async () => {
    // open the circuit
    await breaker.recordFailure("openai");
    await breaker.recordFailure("openai");
    await breaker.recordFailure("openai");

    // advance time past open duration to trigger half-open
    now += 30_001;

    await route(baseRequest, {
      breaker,
      callers: { openai: successCaller("openai", "gpt-4o") },
    });

    const status = await breaker.getStatus("openai");
    expect(status.state).toBe("closed");
    expect(status.failure_count).toBe(0);
  });
});
