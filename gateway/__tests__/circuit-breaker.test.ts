import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker";
import type { RedisLike } from "../src/circuit-breaker";

class FakeRedis implements RedisLike {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
}

let redis: FakeRedis;
let now: number;
let cb: CircuitBreaker;

beforeEach(() => {
  redis = new FakeRedis();
  now = 1_000_000;
  cb = new CircuitBreaker(redis, () => now);
});

describe("getStatus", () => {
  it("returns default closed status when no data", async () => {
    const status = await cb.getStatus("openai");
    expect(status.state).toBe("closed");
    expect(status.failure_count).toBe(0);
    expect(status.opened_at).toBeNull();
    expect(status.last_failure_at).toBeNull();
  });
});

describe("effectiveState", () => {
  it("returns closed when no data", async () => {
    expect(await cb.effectiveState("openai")).toBe("closed");
  });

  it("returns open immediately after opening", async () => {
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");
    await cb.recordFailure("openai"); // opens
    expect(await cb.effectiveState("openai")).toBe("open");
  });

  it("transitions open → half-open after 30s", async () => {
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");
    await cb.recordFailure("openai"); // opens at t=1_000_000

    now += 30_001; // advance past OPEN_DURATION_MS
    expect(await cb.effectiveState("openai")).toBe("half-open");
  });

  it("stays open before 30s elapses", async () => {
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");

    now += 29_999;
    expect(await cb.effectiveState("openai")).toBe("open");
  });
});

describe("recordFailure", () => {
  it("increments failure_count on first failure", async () => {
    await cb.recordFailure("anthropic");
    const status = await cb.getStatus("anthropic");
    expect(status.failure_count).toBe(1);
    expect(status.state).toBe("closed");
  });

  it("stays closed on 2 failures", async () => {
    await cb.recordFailure("anthropic");
    await cb.recordFailure("anthropic");
    expect((await cb.getStatus("anthropic")).state).toBe("closed");
  });

  it("opens on 3rd consecutive failure", async () => {
    await cb.recordFailure("anthropic");
    await cb.recordFailure("anthropic");
    await cb.recordFailure("anthropic");
    const status = await cb.getStatus("anthropic");
    expect(status.state).toBe("open");
    expect(status.opened_at).toBe(now);
  });

  it("resets count when gap exceeds 60s window", async () => {
    await cb.recordFailure("groq");
    await cb.recordFailure("groq");
    // gap beyond window — count resets
    now += 60_001;
    await cb.recordFailure("groq");
    const status = await cb.getStatus("groq");
    expect(status.failure_count).toBe(1);
    expect(status.state).toBe("closed");
  });

  it("sets last_failure_at", async () => {
    await cb.recordFailure("groq");
    expect((await cb.getStatus("groq")).last_failure_at).toBe(now);
  });

  it("each provider tracked independently", async () => {
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");
    await cb.recordFailure("openai"); // opens openai

    const groqStatus = await cb.getStatus("groq");
    expect(groqStatus.state).toBe("closed");
    expect(groqStatus.failure_count).toBe(0);
  });
});

describe("recordSuccess", () => {
  it("resets circuit to closed after open", async () => {
    await cb.recordFailure("anthropic");
    await cb.recordFailure("anthropic");
    await cb.recordFailure("anthropic");
    expect((await cb.getStatus("anthropic")).state).toBe("open");

    await cb.recordSuccess("anthropic");
    const status = await cb.getStatus("anthropic");
    expect(status.state).toBe("closed");
    expect(status.failure_count).toBe(0);
    expect(status.opened_at).toBeNull();
  });

  it("resets circuit to closed from half-open", async () => {
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");
    await cb.recordFailure("openai");
    now += 30_001;
    await cb.effectiveState("openai"); // trigger half-open write

    await cb.recordSuccess("openai");
    expect((await cb.getStatus("openai")).state).toBe("closed");
  });
});
