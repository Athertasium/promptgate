import { createHash } from "crypto";
import type { UnifiedRequest, UnifiedResponse } from "@promptgate/shared";

const DEFAULT_TTL_S = 3600; // 1 hour

export interface CacheRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

function cacheKey(req: UnifiedRequest): string {
  const canonical = JSON.stringify({
    tier: req.tier,
    messages: req.messages,
    max_tokens: req.max_tokens,
    // normalize missing temperature so undefined and null hash identically
    temperature: req.temperature ?? null,
  });
  return `cache:${createHash("sha256").update(canonical).digest("hex")}`;
}

export class ExactMatchCache {
  constructor(
    private readonly redis: CacheRedis,
    private readonly ttlSeconds = DEFAULT_TTL_S
  ) {}

  async get(req: UnifiedRequest): Promise<UnifiedResponse | null> {
    const raw = await this.redis.get(cacheKey(req));
    if (!raw) return null;
    const stored = JSON.parse(raw) as UnifiedResponse;
    return { ...stored, cache_hit: true };
  }

  async set(req: UnifiedRequest, res: UnifiedResponse): Promise<void> {
    await this.redis.setex(cacheKey(req), this.ttlSeconds, JSON.stringify(res));
  }
}
