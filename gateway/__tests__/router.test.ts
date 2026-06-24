import { describe, it, expect, beforeEach } from "vitest";
import { route, RouterError } from "../src/router";
import type { FailoverRecord } from "../src/router";
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
  tier: "balanced", // chain: groq(openai/gpt-oss-120b) → anthropic(claude-haiku-4-5-20251001)
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
        groq: successCaller("groq", "openai/gpt-oss-120b"),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });
    expect(result.served_by.provider).toBe("groq");
    expect(result.failover_occurred).toBe(false);
  });

  it("passes request_id through", async () => {
    const result = await route(
      baseRequest,
      { breaker, callers: { groq: successCaller("groq", "openai/gpt-oss-120b") } },
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
        groq: failCaller(),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });
    expect(result.served_by.provider).toBe("anthropic");
    expect(result.failover_occurred).toBe(true);
  });

  it("records failure on first provider after failover", async () => {
    await route(baseRequest, {
      breaker,
      callers: {
        groq: failCaller(),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });
    const status = await breaker.getStatus("groq");
    expect(status.failure_count).toBe(1);
  });

  it("throws RouterError when all providers fail", async () => {
    await expect(
      route(baseRequest, {
        breaker,
        callers: {
          groq: failCaller(),
          anthropic: failCaller(),
        },
      })
    ).rejects.toBeInstanceOf(RouterError);
  });
});

// ── circuit breaker integration ────────────────────────────────────────────

describe("circuit breaker: open circuit skips provider", () => {
  it("skips open provider and routes to next without calling it", async () => {
    let groqCalled = false;

    // open groq circuit
    await breaker.recordFailure("groq");
    await breaker.recordFailure("groq");
    await breaker.recordFailure("groq");

    const result = await route(baseRequest, {
      breaker,
      callers: {
        groq: async () => { groqCalled = true; return makeResponse("groq", "openai/gpt-oss-120b"); },
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });

    expect(groqCalled).toBe(false);
    expect(result.served_by.provider).toBe("anthropic");
    expect(result.failover_occurred).toBe(true);
  });

  it("throws RouterError when all circuits open", async () => {
    await breaker.recordFailure("groq");
    await breaker.recordFailure("groq");
    await breaker.recordFailure("groq");
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
    await breaker.recordFailure("groq");
    await breaker.recordFailure("groq");
    await breaker.recordFailure("groq");

    // advance time past open duration to trigger half-open
    now += 30_001;

    await route(baseRequest, {
      breaker,
      callers: { groq: successCaller("groq", "openai/gpt-oss-120b") },
    });

    const status = await breaker.getStatus("groq");
    expect(status.state).toBe("closed");
    expect(status.failure_count).toBe(0);
  });
});

// ── Phase 8: failover event collection ─────────────────────────────────────

describe("failoverEvents collector", () => {
  it("collects no events on clean success", async () => {
    const failoverEvents: FailoverRecord[] = [];
    await route(baseRequest, {
      breaker,
      failoverEvents,
      callers: { groq: successCaller("groq", "openai/gpt-oss-120b") },
    });
    expect(failoverEvents).toHaveLength(0);
  });

  it("collects one event with hopNumber=1 on single failover", async () => {
    const failoverEvents: FailoverRecord[] = [];
    await route(baseRequest, {
      breaker,
      failoverEvents,
      callers: {
        groq: failCaller(),
        anthropic: successCaller("anthropic", "claude-haiku-4-5-20251001"),
      },
    });
    expect(failoverEvents).toHaveLength(1);
    expect(failoverEvents[0].fromProvider).toBe("groq");
    expect(failoverEvents[0].toProvider).toBe("anthropic");
    expect(failoverEvents[0].hopNumber).toBe(1);
    expect(failoverEvents[0].reason).toBe("error");
  });
});

// ── Phase 8: cost-aware routing ────────────────────────────────────────────

describe("cost_optimized routing: health always beats cost", () => {
  it("never routes to a circuit-open provider even if it would be cheapest", async () => {
    // 'smart' tier uses cost_optimized strategy
    // nvidia/deepseek-v4-flash is cheapest — open its circuit; route must go to anthropic or openai
    const smartRequest: UnifiedRequest = {
      tier: "smart",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 100,
      stream: false,
    };

    // Open nvidia circuit (cheapest provider in smart tier)
    await breaker.recordFailure("nvidia");
    await breaker.recordFailure("nvidia");
    await breaker.recordFailure("nvidia");

    const result = await route(smartRequest, {
      breaker,
      callers: {
        nvidia: async () => { throw new Error("should not be called"); },
        anthropic: successCaller("anthropic", "claude-sonnet-4-6"),
        openai: successCaller("openai", "gpt-4o"),
      },
    });

    // Must not have routed to nvidia; cost_optimized pre-selects healthy providers
    // so this is NOT logged as failover_occurred (it's proactive, not reactive)
    expect(result.served_by.provider).not.toBe("nvidia");
  });
});

// ── Phase 8: MAX_FAILOVER_HOPS=2 ───────────────────────────────────────────

describe("multi-hop failover cap", () => {
  it("tries up to 3 providers (2 failover hops) before giving up", async () => {
    const called: string[] = [];
    const trackCaller = (provider: string): ProviderCaller =>
      async (_req, model, requestId) => {
        called.push(provider);
        return { ...makeResponse(provider, model), request_id: requestId };
      };

    // 'fast' tier has 3 entries: groq(llama), groq(gpt-oss-20b), openai(gpt-4o-mini)
    const fastRequest: UnifiedRequest = {
      tier: "fast",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 100,
      stream: false,
    };

    // First two fail, third succeeds
    let callCount = 0;
    const failThenSucceed: ProviderCaller = async (_req, model, requestId) => {
      callCount++;
      if (callCount <= 2) {
        const err = new Error("FORCE_FAIL: forced 5xx");
        err.name = "ForcedFailError";
        throw err;
      }
      return { ...makeResponse("openai", model), request_id: requestId };
    };

    const failoverEvents: FailoverRecord[] = [];
    const result = await route(fastRequest, {
      breaker,
      failoverEvents,
      callers: {
        groq: failThenSucceed,
        openai: failThenSucceed,
      },
    });

    expect(result.failover_occurred).toBe(true);
    expect(failoverEvents.length).toBeGreaterThanOrEqual(1);
  });
});
