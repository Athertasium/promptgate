import Groq from "groq-sdk";
import type {
  UnifiedRequest,
  UnifiedResponse,
  StopReason,
  StreamEvent,
} from "@promptgate/shared";
import { randomUUID } from "crypto";

// Pricing per 1M tokens (USD) — as of 2025-06
const PRICING: Record<string, { input: number; output: number }> = {
  "llama-3.3-70b-versatile": { input: 0.59,  output: 0.79  },
  "llama-3.1-8b-instant":    { input: 0.05,  output: 0.08  },
  "openai/gpt-oss-20b":      { input: 0.075, output: 0.30  },
  "openai/gpt-oss-120b":     { input: 0.15,  output: 0.60  },
};

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens / 1_000_000) * price.input +
         (outputTokens / 1_000_000) * price.output;
}

// Groq is OpenAI-API-compatible — finish_reason strings are identical to OpenAI.
// This is a 2-way mapping problem (OpenAI/Groq vs Anthropic), not 3-way.
function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":           return "end_turn";
    case "length":         return "max_tokens";
    case "tool_calls":     return "tool_use";
    case "content_filter": return "content_filter";
    default:               return "end_turn";
  }
}

export function toProviderFormat(
  unified: UnifiedRequest,
  model: string
) {
  return {
    model,
    max_tokens: unified.max_tokens,
    ...(unified.temperature !== undefined && { temperature: unified.temperature }),
    messages: unified.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: false,
  };
}

export function fromProviderFormat(
  raw: Groq.Chat.ChatCompletion,
  requestId: string,
  latency_ms: number,
  failover_occurred: boolean
): UnifiedResponse {
  const choice = raw.choices[0];
  const content = choice?.message?.content ?? "";
  const inputTokens = raw.usage?.prompt_tokens ?? 0;
  const outputTokens = raw.usage?.completion_tokens ?? 0;

  return {
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCost(raw.model, inputTokens, outputTokens),
    },
    served_by: { provider: "groq", model: raw.model },
    failover_occurred,
    cache_hit: false,
    latency_ms,
    request_id: requestId,
  };
}

export class ForcedFailError extends Error {
  constructor() {
    super("FORCE_FAIL: groq adapter forced failure");
    this.name = "ForcedFailError";
  }
}

export async function* streamGroq(
  unified: UnifiedRequest,
  model: string,
  requestId: string = randomUUID()
): AsyncGenerator<StreamEvent> {
  if (process.env.FORCE_FAIL_PROVIDER === "groq") {
    throw new ForcedFailError();
  }

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const start = Date.now();

  const stream = await client.chat.completions.create({
    model,
    max_tokens: unified.max_tokens,
    ...(unified.temperature !== undefined && { temperature: unified.temperature }),
    messages: unified.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = "end_turn";
  let finalModel = model;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { type: "delta", content: delta };

    const finish = chunk.choices[0]?.finish_reason;
    if (finish) stopReason = mapStopReason(finish);

    if (chunk.x_groq?.usage) {
      inputTokens = chunk.x_groq.usage.prompt_tokens ?? 0;
      outputTokens = chunk.x_groq.usage.completion_tokens ?? 0;
    }
    if (chunk.model) finalModel = chunk.model;
  }

  yield {
    type: "done",
    stop_reason: stopReason,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCost(finalModel, inputTokens, outputTokens),
    },
    served_by: { provider: "groq", model: finalModel },
    failover_occurred: false,
    request_id: requestId,
    latency_ms: Date.now() - start,
  };
}

export async function callGroq(
  unified: UnifiedRequest,
  model: string,
  requestId: string = randomUUID()
): Promise<UnifiedResponse> {
  if (process.env.FORCE_FAIL_PROVIDER === "groq") {
    throw new ForcedFailError();
  }

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const start = Date.now();
  const raw = await client.chat.completions.create(toProviderFormat(unified, model)) as Groq.Chat.ChatCompletion;
  const latency_ms = Date.now() - start;

  return fromProviderFormat(raw, requestId, latency_ms, false);
}
