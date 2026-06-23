import { describe, it, expect } from "vitest";
import { SemanticCacheLog } from "../src/semantic-cache";
import type { EmbeddingProvider } from "../src/semantic-cache";
import type { UnifiedRequest } from "@promptgate/shared";

// Deterministic embeddings: map text to a unit vector in a small space.
// "identical" → same vector (similarity 1.0)
// "orthogonal" → perpendicular vectors (similarity 0.0)
function makeEmbedder(map: Record<string, number[]>): EmbeddingProvider {
  return {
    embed: async (text: string) => {
      for (const [key, vec] of Object.entries(map)) {
        if (text.includes(key)) return vec;
      }
      return [0, 0, 0, 1]; // fallback — orthogonal to everything in map
    },
  };
}

const EMBEDDINGS = {
  "hello":    [1, 0, 0, 0],
  "goodbye":  [0, 1, 0, 0],
  "farewell": [0, 0.99, 0.14, 0],  // near "goodbye", cos≈0.99
};

function req(content: string): UnifiedRequest {
  return {
    tier: "fast",
    messages: [{ role: "user", content }],
    max_tokens: 100,
    stream: false,
  };
}

describe("SemanticCacheLog", () => {
  it("returns similarity_score=0 and would_have_hit=false when store empty", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    const obs = await log.observe(req("hello world"), "key-1");
    expect(obs.similarity_score).toBe(0);
    expect(obs.would_have_hit).toBe(false);
    expect(obs.matched_cache_key).toBeNull();
  });

  it("stores embedding after observe", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    await log.observe(req("hello"), "key-1");
    expect(log.size).toBe(1);
  });

  it("identical request scores 1.0 on second call", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    await log.observe(req("hello"), "key-1");
    const obs = await log.observe(req("hello"), "key-2");
    expect(obs.similarity_score).toBeCloseTo(1.0, 5);
    expect(obs.matched_cache_key).toBe("key-1");
  });

  it("orthogonal request scores 0", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    await log.observe(req("hello"), "key-1");
    const obs = await log.observe(req("goodbye"), "key-2");
    expect(obs.similarity_score).toBeCloseTo(0, 5);
    expect(obs.would_have_hit).toBe(false);
  });

  it("near-match scores high but not 1.0", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    await log.observe(req("goodbye"), "key-1");
    const obs = await log.observe(req("farewell"), "key-2");
    expect(obs.similarity_score).toBeGreaterThan(0.95);
    expect(obs.similarity_score).toBeLessThan(1.0);
  });

  it("would_have_hit=true when score >= threshold", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS), 0.5);
    await log.observe(req("hello"), "key-1");
    const obs = await log.observe(req("hello"), "key-2");
    expect(obs.would_have_hit).toBe(true);
  });

  it("would_have_hit=false when score < threshold", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS), 0.99);
    await log.observe(req("goodbye"), "key-1");
    const obs = await log.observe(req("farewell"), "key-2");
    // farewell/goodbye cosine ~0.99 — below the 0.99 strict threshold (< not <=)
    // Test that threshold boundary works: use 1.0 threshold to force false
    const log2 = new SemanticCacheLog(makeEmbedder(EMBEDDINGS), 1.01);
    await log2.observe(req("hello"), "key-x");
    const obs2 = await log2.observe(req("hello"), "key-y");
    expect(obs2.would_have_hit).toBe(false);
  });

  it("returns best match across multiple entries", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    await log.observe(req("hello"), "key-hello");
    await log.observe(req("goodbye"), "key-goodbye");
    const obs = await log.observe(req("farewell"), "key-3");
    // "farewell" is closer to "goodbye" than "hello"
    expect(obs.matched_cache_key).toBe("key-goodbye");
    expect(obs.similarity_score).toBeGreaterThan(0.9);
  });

  it("evicts oldest entry when maxEntries exceeded", async () => {
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS), 0.92, 2);
    await log.observe(req("hello"), "key-1");    // slot 1
    await log.observe(req("goodbye"), "key-2");  // slot 2
    await log.observe(req("farewell"), "key-3"); // evicts key-1, slot 2
    expect(log.size).toBe(2);
    // Now query "hello" — key-1 was evicted, only goodbye/farewell remain
    const obs = await log.observe(req("hello"), "key-4");
    expect(obs.matched_cache_key).not.toBe("key-1");
  });

  it("does not compare request against itself (store-after-observe)", async () => {
    // First call with empty store: similarity=0, THEN stores embedding
    // Second identical call should find the first stored entry, not itself
    const log = new SemanticCacheLog(makeEmbedder(EMBEDDINGS));
    const first = await log.observe(req("hello"), "key-1");
    expect(first.similarity_score).toBe(0); // nothing stored yet when comparing
    const second = await log.observe(req("hello"), "key-2");
    expect(second.similarity_score).toBeCloseTo(1.0, 5); // finds key-1
  });
});
