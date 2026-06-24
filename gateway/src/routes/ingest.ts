import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Redis } from "ioredis";
import type { UnifiedRequest } from "@promptgate/shared";
import type { CircuitBreaker } from "../circuit-breaker.js";
import type { ExactMatchCache } from "../cache.js";
import type { SemanticCacheLog } from "../semantic-cache.js";
import { authenticate } from "../auth.js";
import { checkGuardrails, checkOutputPII } from "../guardrails/index.js";
import { route, routeStream } from "../router.js";
import type { StreamDone } from "@promptgate/shared";
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
  stream: z.boolean().default(false),
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
      await logRequest(processedReq, cacheRes, { cache_type: "exact" });
      await logGuardrailEvents(requestId, guardrailResult.matches);
      return reply.send(cacheRes);
    }

    // Streaming path — no cache, no output PII redaction, no semantic cache observation
    if (processedReq.stream) {
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.hijack();

      try {
        let doneEvent: StreamDone | null = null;
        const streamStartMs = Date.now();
        let ttftMs: number | null = null;
        const gen = routeStream(processedReq, { breaker: deps.breaker }, requestId);

        for await (const event of gen) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "delta" && ttftMs === null) {
            ttftMs = Date.now() - streamStartMs;
          }
          if (event.type === "done") doneEvent = event;
        }

        reply.raw.write("data: [DONE]\n\n");

        if (doneEvent) {
          const streamedResponse: import("@promptgate/shared").UnifiedResponse = {
            content: "",
            stop_reason: doneEvent.stop_reason,
            usage: doneEvent.usage,
            served_by: doneEvent.served_by,
            failover_occurred: doneEvent.failover_occurred,
            cache_hit: false,
            latency_ms: doneEvent.latency_ms,
            request_id: requestId,
          };
          await logRequest(processedReq, streamedResponse, { ttft_ms: ttftMs ?? undefined });
          await logGuardrailEvents(requestId, guardrailResult.matches);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        reply.raw.write(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
      } finally {
        reply.raw.end();
      }
      return;
    }

    // Non-streaming path — route to provider
    const failoverEvents: import("../router.js").FailoverRecord[] = [];
    let response;
    try {
      response = await route(
        processedReq,
        { breaker: deps.breaker, failoverEvents },
        requestId
      );
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
      ...failoverEvents.map((ev) =>
        logFailoverEvent(requestId, ev.fromProvider, ev.toProvider, ev.reason, ev.hopNumber)
      ),
    ];

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
