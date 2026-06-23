import OpenAI from "openai";
import type {
  UnifiedRequest,
  UnifiedResponse,
  StopReason,
} from "@promptgate/shared";
import { randomUUID } from "crypto";

// Pricing per 1M tokens (USD) — as of 2025-06
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o":      { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
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

// OpenAI finish_reason strings differ from Anthropic stop_reason strings.
// Groq mirrors OpenAI format (OpenAI-compatible API), so this mapping covers both.
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
): OpenAI.ChatCompletionCreateParamsNonStreaming {
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
  raw: OpenAI.ChatCompletion,
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
    served_by: { provider: "openai", model: raw.model },
    failover_occurred,
    cache_hit: false,
    latency_ms,
    request_id: requestId,
  };
}

export class ForcedFailError extends Error {
  constructor() {
    super("FORCE_FAIL: openai adapter forced failure");
    this.name = "ForcedFailError";
  }
}

export async function callOpenAI(
  unified: UnifiedRequest,
  model: string,
  requestId = randomUUID()
): Promise<UnifiedResponse> {
  if (process.env.FORCE_FAIL_PROVIDER === "openai") {
    throw new ForcedFailError();
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const start = Date.now();
  const raw = await client.chat.completions.create(toProviderFormat(unified, model));
  const latency_ms = Date.now() - start;

  return fromProviderFormat(raw, requestId, latency_ms, false);
}
