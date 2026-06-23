import { describe, it, expect, beforeEach } from "vitest";
import { ExactMatchCache } from "../src/cache";
import type { CacheRedis } from "../src/cache";
import type { UnifiedRequest, UnifiedResponse } from "@promptgate/shared";

class FakeCacheRedis implements CacheRedis {
  store = new Map<string, string>();
  ttlLog: Array<{ key: string; ttl: number }> = [];

  async get(key: string) { return this.store.get(key) ?? null; }
  async setex(key: string, ttl: number, value: string) {
    this.ttlLog.push({ key, ttl });
    this.store.set(key, value);
  }
}

const BASE_REQ: UnifiedRequest = {
  tier: "fast",
  messages: [{ role: "user", content: "hello" }],
  max_tokens: 100,
  stream: false,
};

const BASE_RES: UnifiedResponse = {
  content: "hi",
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 },
  served_by: { provider: "groq", model: "llama-3.3-70b-versatile" },
  failover_occurred: false,
  cache_hit: false,
  latency_ms: 50,
  request_id: "req-1",
};

describe("ExactMatchCache", () => {
  let redis: FakeCacheRedis;
  let cache: ExactMatchCache;

  beforeEach(() => {
    redis = new FakeCacheRedis();
    cache = new ExactMatchCache(redis);
  });

  it("returns null on cache miss", async () => {
    expect(await cache.get(BASE_REQ)).toBeNull();
  });

  it("returns stored response on hit with cache_hit=true", async () => {
    await cache.set(BASE_REQ, BASE_RES);
    const hit = await cache.get(BASE_REQ);
    expect(hit).not.toBeNull();
    expect(hit!.cache_hit).toBe(true);
    expect(hit!.content).toBe("hi");
  });

  it("cache_hit on original stored response is overridden to true", async () => {
    await cache.set(BASE_REQ, { ...BASE_RES, cache_hit: false });
    const hit = await cache.get(BASE_REQ);
    expect(hit!.cache_hit).toBe(true);
  });

  it("different requests produce different keys (no collision)", async () => {
    const req2: UnifiedRequest = { ...BASE_REQ, messages: [{ role: "user", content: "different" }] };
    await cache.set(BASE_REQ, BASE_RES);
    expect(await cache.get(req2)).toBeNull();
  });

  it("metadata/caller_id excluded from key — same logical request hits", async () => {
    const withMeta: UnifiedRequest = {
      ...BASE_REQ,
      metadata: { caller_id: "app-a", tags: ["prod"] },
    };
    await cache.set(BASE_REQ, BASE_RES);
    const hit = await cache.get(withMeta);
    expect(hit).not.toBeNull();
  });

  it("temperature=undefined and temperature=null hash identically", async () => {
    const withNull: UnifiedRequest = { ...BASE_REQ, temperature: undefined };
    const withUndef: UnifiedRequest = { ...BASE_REQ };
    await cache.set(withNull, BASE_RES);
    expect(await cache.get(withUndef)).not.toBeNull();
  });

  it("different temperature → different key", async () => {
    const hot: UnifiedRequest = { ...BASE_REQ, temperature: 1.0 };
    await cache.set(BASE_REQ, BASE_RES);
    expect(await cache.get(hot)).toBeNull();
  });

  it("uses default 1-hour TTL", async () => {
    await cache.set(BASE_REQ, BASE_RES);
    expect(redis.ttlLog[0].ttl).toBe(3600);
  });

  it("respects custom TTL", async () => {
    const shortCache = new ExactMatchCache(redis, 300);
    await shortCache.set(BASE_REQ, BASE_RES);
    expect(redis.ttlLog[0].ttl).toBe(300);
  });
});
