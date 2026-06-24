import type { UnifiedRequest, UnifiedResponse } from "@promptgate/shared";
import type { GuardrailMatch } from "./guardrails/index.js";
import type { SemanticObservation } from "./semantic-cache.js";
import { getDb } from "./db.js";

export async function logRequest(req: UnifiedRequest, res: UnifiedResponse): Promise<void> {
  await getDb().request.create({
    data: {
      id: res.request_id,
      tier: req.tier,
      served_by_provider: res.served_by.provider,
      served_by_model: res.served_by.model,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cost_usd: res.usage.cost_usd,
      latency_ms: res.latency_ms,
      cache_hit: res.cache_hit,
      failover_occurred: res.failover_occurred,
      caller_id: req.metadata?.caller_id ?? null,
      tags: req.metadata?.tags ?? [],
    },
  });
}

export async function logFailoverEvent(
  requestId: string,
  fromProvider: string,
  toProvider: string,
  reason: string,
  hopNumber?: number,
  addedLatencyMs?: number
): Promise<void> {
  await getDb().failoverEvent.create({
    data: {
      request_id: requestId,
      from_provider: fromProvider,
      to_provider: toProvider,
      reason,
      hop_number: hopNumber ?? null,
      added_latency_ms: addedLatencyMs ?? null,
    },
  });
}

export async function logGuardrailEvents(
  requestId: string,
  matches: GuardrailMatch[]
): Promise<void> {
  if (matches.length === 0) return;
  await getDb().guardrailEvent.createMany({
    data: matches.map((m) => ({
      request_id: requestId,
      check_type: m.check_type,
      action: m.action,
      detail: { pattern_type: m.pattern_type },
    })),
  });
}

export async function logSemanticCacheObservation(
  requestId: string,
  obs: SemanticObservation
): Promise<void> {
  await getDb().semanticCacheLog.create({
    data: {
      request_id: requestId,
      similarity_score: obs.similarity_score,
      would_have_hit: obs.would_have_hit,
      matched_cache_key: obs.matched_cache_key ?? null,
    },
  });
}
