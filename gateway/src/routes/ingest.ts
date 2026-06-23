import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { MODEL_TIERS } from "@promptgate/shared";
import type { UnifiedRequest } from "@promptgate/shared";
import type { CircuitBreaker } from "../circuit-breaker.js";
import type { ExactMatchCache } from "../cache.js";
import type { SemanticCacheLog } from "../semantic-cache.js";
import { checkGuardrails } from "../guardrails.js";
import { route } from "../router.js";
import {
  logRequest,
  logFailoverEvent,
  logGuardrailEvents,
  logSemanticCacheObservation,
} from "../logger.js";

export interface IngestDeps {
  breaker: CircuitBreaker;
  cache: ExactMatchCache;
  semanticCacheLog?: SemanticCacheLog;
}

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const bodySchema = z.object({
  tier: z.enum(["fast", "balanced", "smart", "thinking"]),
  messages: z.array(messageSchema).min(1),
  max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.literal(false),
  metadata: z
    .object({
      caller_id: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export async function ingestRoute(app: FastifyInstance, deps: IngestDeps): Promise<void> {
  app.post("/v1/complete", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const req = parsed.data as UnifiedRequest;
    const requestId = randomUUID();

    // Guardrails
    const guardrailResult = checkGuardrails(req);
    if (!guardrailResult.passed) {
      // Log before returning — fire-and-forget; don't block the 400
      logGuardrailEvents(requestId, guardrailResult.matches).catch(() => {});
      return reply.status(400).send({ error: "Request blocked by guardrails" });
    }

    const processedReq: UnifiedRequest = { ...req, messages: guardrailResult.messages };

    // Exact-match cache check
    const cached = await deps.cache.get(processedReq);
    if (cached) {
      const cacheRes = { ...cached, request_id: requestId };
      await Promise.all([
        logRequest(processedReq, cacheRes),
        logGuardrailEvents(requestId, guardrailResult.matches),
      ]);
      return reply.send(cacheRes);
    }

    // Route to provider
    const start = Date.now();
    let response;
    try {
      response = await route(processedReq, { breaker: deps.breaker }, requestId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "All providers failed";
      return reply.status(502).send({ error: msg });
    }

    // Cache write (non-blocking)
    deps.cache.set(processedReq, response).catch(() => {});

    // Log everything
    const logTasks: Promise<unknown>[] = [
      logRequest(processedReq, response),
      logGuardrailEvents(requestId, guardrailResult.matches),
    ];

    if (response.failover_occurred) {
      // Infer from_provider: first provider in tier chain that isn't served_by
      const chain = MODEL_TIERS[processedReq.tier];
      const fromProvider = chain[0].provider;
      const toProvider = response.served_by.provider;
      if (fromProvider !== toProvider) {
        logTasks.push(logFailoverEvent(requestId, fromProvider, toProvider, "error"));
      }
    }

    if (deps.semanticCacheLog) {
      const cacheKey = `${processedReq.tier}:${requestId}`;
      logTasks.push(
        deps.semanticCacheLog
          .observe(processedReq, cacheKey)
          .then((obs) => logSemanticCacheObservation(requestId, obs))
          .catch(() => {})
      );
    }

    await Promise.all(logTasks);

    return reply.send(response);
  });
}
