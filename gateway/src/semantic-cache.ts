import type { UnifiedRequest } from "@promptgate/shared";

// ponytail: in-memory cosine over last N entries; no pgvector infra needed at this volume
const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_MAX_ENTRIES = 100;

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface SemanticCacheEntry {
  cacheKey: string;
  embedding: number[];
}

export interface SemanticObservation {
  similarity_score: number;   // always logged — this is the data that justifies the threshold
  would_have_hit: boolean;    // score >= threshold; NOT served in v1, observation only
  matched_cache_key: string | null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function requestToText(req: UnifiedRequest): string {
  return req.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

export class SemanticCacheLog {
  private entries: SemanticCacheEntry[] = [];

  constructor(
    private readonly embedder: EmbeddingProvider,
    private readonly threshold = DEFAULT_THRESHOLD,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES
  ) {}

  async observe(req: UnifiedRequest, exactCacheKey: string): Promise<SemanticObservation> {
    const embedding = await this.embedder.embed(requestToText(req));

    let bestScore = 0;
    let bestKey: string | null = null;
    for (const entry of this.entries) {
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestKey = entry.cacheKey;
      }
    }

    // Evict oldest if at capacity, then store current
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push({ cacheKey: exactCacheKey, embedding });

    return {
      similarity_score: bestScore,
      would_have_hit: bestScore >= this.threshold,
      matched_cache_key: bestKey,
    };
  }

  get size(): number { return this.entries.length; }
}
