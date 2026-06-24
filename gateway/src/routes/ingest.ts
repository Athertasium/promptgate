import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import { MODEL_TIERS } from "@promptgate/shared";
import type { UnifiedRequest } from "@promptgate/shared";
import type { CircuitBreaker } from "../circuit-breaker.js";
import type { ExactMatchCache } from "../cache.js";
import type { SemanticCacheLog } from "../semantic-cache.js";
import { authenticate } from "../auth.js";
import { checkGuardrails, checkOutputPII } from "../guardrails.js";
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
  redis: Redis;
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

    // Auth — before guardrails; unauthenticated/rate-limited requests don't reach providers
    const rawKey = (request.headers["x-api-key"] as string | undefined) ?? "";
    const auth = await authenticate(rawKey, req.tier, deps.redis);
    if (!auth.ok) {
      app.log.warn({ status: auth.status }, "auth failed");
      return reply.status(auth.status).send({
        error: auth.status === 429 ? "Rate limit exceeded" : "Unauthorized",
      });
    }

    // Guardrails
    const guardrailResult = checkGuardrails(req);
    if (!guardrailResult.passed) {
      // Blocked requests have no request row — log to server log only, not DB
      app.log.warn({ matches: guardrailResult.matches }, "request blocked by guardrails");
      return reply.status(400).send({ error: "Request blocked by guardrails" });
    }

    // caller_id from verified key overrides any client-supplied value (closes v1 spoofability gap)
    const processedReq: UnifiedRequest = {
      ...req,
      messages: guardrailResult.messages,
      metadata: { ...req.metadata, caller_id: auth.callerId },
    };

    // Exact-match cache check
    const cached = await deps.cache.get(processedReq);
    if (cached) {
      const cacheRes = { ...cached, request_id: requestId };
      // logRequest must complete before logGuardrailEvents (FK dependency)
      await logRequest(processedReq, cacheRes);
      await logGuardrailEvents(requestId, guardrailResult.matches);
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

    // Output-path PII redaction (v2 §5)
    const outputGuardrail = checkOutputPII(response.content);
    if (outputGuardrail.matches.length > 0) {
      response = { ...response, content: outputGuardrail.content };
    }

    // Cache write (non-blocking)
    deps.cache.set(processedReq, response).catch(() => {});

    // Log: request row must exist before any child rows (FK dependency)
    await logRequest(processedReq, response);

    const allGuardrailMatches = [...guardrailResult.matches, ...outputGuardrail.matches];
    const childLogTasks: Promise<unknown>[] = [
      logGuardrailEvents(requestId, allGuardrailMatches),
    ];

    if (response.failover_occurred) {
      // Infer from_provider: first provider in tier chain that isn't served_by
      const chain = MODEL_TIERS[processedReq.tier];
      const fromProvider = chain[0].provider;
      const toProvider = response.served_by.provider;
      if (fromProvider !== toProvider) {
        childLogTasks.push(logFailoverEvent(requestId, fromProvider, toProvider, "error"));
      }
    }

    if (deps.semanticCacheLog) {
      const cacheKey = `${processedReq.tier}:${requestId}`;
      childLogTasks.push(
        deps.semanticCacheLog
          .observe(processedReq, cacheKey)
          .then((obs) => logSemanticCacheObservation(requestId, obs))
          .catch(() => {})
      );
    }

    await Promise.all(childLogTasks);

    return reply.send(response);
  });
}
