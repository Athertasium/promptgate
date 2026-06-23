import OpenAI from "openai";
import type {
  UnifiedRequest,
  UnifiedResponse,
  StopReason,
} from "@promptgate/shared";
import { randomUUID } from "crypto";

// Pricing per 1M tokens (USD) — as of 2025-06
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-ai/deepseek-v4-flash":       { input: 0.09,  output: 0.18  },
  "deepseek-ai/deepseek-pro":            { input: 0.44,  output: 0.87  },
  "nvidia/nemotron-3-ultra-550b-a55b":   { input: 0.5,   output: 2.20  },
};

// Models that require thinking/reasoning budget params
const THINKING_MODELS = new Set([
  "nvidia/nemotron-3-ultra-550b-a55b",
]);

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens / 1_000_000) * price.input +
         (outputTokens / 1_000_000) * price.output;
}

// NVIDIA API is OpenAI-compatible — finish_reason strings are identical to OpenAI.
function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":           return "end_turn";
    case "length":         return "max_tokens";
    case "tool_calls":     return "tool_use";
    case "content_filter": return "content_filter";
    default:               return "end_turn";
  }
}

export function toProviderFormat(unified: UnifiedRequest, model: string) {
  const isThinking = THINKING_MODELS.has(model);

  return {
    model,
    max_tokens: unified.max_tokens,
    ...(unified.temperature !== undefined && { temperature: unified.temperature }),
    messages: unified.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: false as const,
    // ponytail: extra params passed through; NVIDIA ignores unknowns for non-thinking models
    ...(isThinking && {
      reasoning_budget: unified.max_tokens,
      chat_template_kwargs: { enable_thinking: true },
    }),
  };
}

export function fromProviderFormat(
  raw: OpenAI.Chat.ChatCompletion,
  requestId: string,
  latency_ms: number,
  failover_occurred: boolean
): UnifiedResponse {
  const choice = raw.choices[0];
  const message = choice?.message as OpenAI.Chat.ChatCompletionMessage & {
    reasoning_content?: string;
  };

  // For thinking models, reasoning_content arrives separately — append it
  // so callers see the full chain-of-thought + answer in content.
  const reasoning = message?.reasoning_content
    ? `<thinking>\n${message.reasoning_content}\n</thinking>\n\n`
    : "";
  const content = reasoning + (message?.content ?? "");

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
    served_by: { provider: "nvidia", model: raw.model },
    failover_occurred,
    cache_hit: false,
    latency_ms,
    request_id: requestId,
  };
}

export class ForcedFailError extends Error {
  constructor() {
    super("FORCE_FAIL: nvidia adapter forced failure");
    this.name = "ForcedFailError";
  }
}

function makeClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
}

export async function callNvidia(
  unified: UnifiedRequest,
  model: string,
  requestId: string = randomUUID()
): Promise<UnifiedResponse> {
  if (process.env.FORCE_FAIL_PROVIDER === "nvidia") {
    throw new ForcedFailError();
  }

  const client = makeClient();
  const start = Date.now();
  const raw = await client.chat.completions.create(
    toProviderFormat(unified, model)
  ) as OpenAI.Chat.ChatCompletion;
  const latency_ms = Date.now() - start;

  return fromProviderFormat(raw, requestId, latency_ms, false);
}
