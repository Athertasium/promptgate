import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateApiKey, hashKey, authenticate } from "../src/auth";

// Fake Redis for rate limit tests
class FakeRedis {
  store = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const v = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, v);
    return v;
  }
  async expire(_key: string, _ttl: number): Promise<void> {}
}

// Fake DB — mocked at module level
vi.mock("../src/db.js", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../src/db.js";

function makeApiKey(overrides: Partial<{
  key_hash: string;
  caller_id: string;
  revoked_at: Date | null;
  rate_limit_rpm: number;
  allowed_tiers: string[];
}> = {}) {
  return {
    id: "uuid-1",
    key_hash: "hash",
    caller_id: "test-caller",
    created_at: new Date(),
    revoked_at: null,
    rate_limit_rpm: 60,
    allowed_tiers: ["fast", "balanced", "smart", "thinking"],
    ...overrides,
  };
}

describe("generateApiKey", () => {
  it("produces pg_live_ prefix key", () => {
    const { key } = generateApiKey();
    expect(key).toMatch(/^pg_live_[0-9a-f]{32}$/);
  });

  it("hash is sha256 hex of the key", () => {
    const { key, hash } = generateApiKey();
    expect(hash).toBe(hashKey(key));
    expect(hash).toHaveLength(64);
  });

  it("each call produces a unique key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("authenticate", () => {
  let redis: FakeRedis;
  let mockFindUnique: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    redis = new FakeRedis();
    mockFindUnique = vi.fn();
    vi.mocked(getDb).mockReturnValue({ apiKey: { findUnique: mockFindUnique } } as unknown as ReturnType<typeof getDb>);
  });

  it("returns 401 when key not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await authenticate("pg_live_bad", "fast", redis as never);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("returns 401 when key is revoked", async () => {
    mockFindUnique.mockResolvedValue(makeApiKey({ revoked_at: new Date() }));
    const result = await authenticate("pg_live_any", "fast", redis as never);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("returns 401 when tier not in allowed_tiers", async () => {
    mockFindUnique.mockResolvedValue(makeApiKey({ allowed_tiers: ["fast"] }));
    const result = await authenticate("pg_live_key", "smart", redis as never);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("returns 200 with callerId on valid key", async () => {
    mockFindUnique.mockResolvedValue(makeApiKey({ caller_id: "my-app" }));
    const result = await authenticate("pg_live_key", "fast", redis as never);
    expect(result).toMatchObject({ ok: true, status: 200, callerId: "my-app" });
  });

  it("returns 429 when rate limit exceeded", async () => {
    const keyRecord = makeApiKey({ rate_limit_rpm: 2 });
    mockFindUnique.mockResolvedValue(keyRecord);
    const key = "pg_live_x";
    // first two succeed
    await authenticate(key, "fast", redis as never);
    await authenticate(key, "fast", redis as never);
    // third hits limit
    const result = await authenticate(key, "fast", redis as never);
    expect(result).toMatchObject({ ok: false, status: 429 });
  });

  it("different keys have independent rate limit buckets", async () => {
    const keyRecord = makeApiKey({ rate_limit_rpm: 1 });
    mockFindUnique.mockResolvedValue(keyRecord);
    const r1 = await authenticate("pg_live_aaa", "fast", redis as never);
    const r2 = await authenticate("pg_live_bbb", "fast", redis as never);
    expect(r1).toMatchObject({ ok: true, status: 200 });
    expect(r2).toMatchObject({ ok: true, status: 200 });
  });
});
