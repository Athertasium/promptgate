import Anthropic from "@anthropic-ai/sdk";
import type {
  UnifiedRequest,
  UnifiedResponse,
  StopReason,
  StreamEvent,
} from "@promptgate/shared";
import { randomUUID } from "crypto";

// Pricing per 1M tokens (USD) — as of 2025-06
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8":    { input: 15.0,  output: 75.0  },
  "claude-sonnet-4-6":  { input: 3.0,   output: 15.0  },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
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

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "end_turn":    return "end_turn";
    case "max_tokens":  return "max_tokens";
    case "tool_use":    return "tool_use";
    case "stop_sequence": return "end_turn";
    default:            return "end_turn";
  }
}

export function toProviderFormat(
  unified: UnifiedRequest,
  model: string
): Anthropic.MessageCreateParamsNonStreaming {
  const systemMessage = unified.messages.find((m) => m.role === "system");
  const nonSystemMessages = unified.messages.filter((m) => m.role !== "system");

  return {
    model,
    max_tokens: unified.max_tokens,
    ...(unified.temperature !== undefined && { temperature: unified.temperature }),
    ...(systemMessage && { system: systemMessage.content }),
    messages: nonSystemMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    stream: false,
  };
}

export function fromProviderFormat(
  raw: Anthropic.Message,
  requestId: string,
  latency_ms: number,
  failover_occurred: boolean
): UnifiedResponse {
  const usage = raw.usage as Anthropic.Usage & {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };

  // Anthropic bills cache_creation_input_tokens at 1.25x input rate;
  // cache_read_input_tokens at 0.1x input rate. We normalize to a flat
  // input_tokens count for simplicity and compute cost separately.
  const totalInputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);

  const outputTokens = usage.output_tokens ?? 0;
  const cost_usd = computeCost(raw.model, totalInputTokens, outputTokens);

  const textBlock = raw.content.find((b) => b.type === "text");
  const content = textBlock && textBlock.type === "text" ? textBlock.text : "";

  return {
    content,
    stop_reason: mapStopReason(raw.stop_reason),
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: outputTokens,
      cost_usd,
    },
    served_by: { provider: "anthropic", model: raw.model },
    failover_occurred,
    cache_hit: false,
    latency_ms,
    request_id: requestId,
  };
}

export class ForcedFailError extends Error {
  constructor() {
    super("FORCE_FAIL: anthropic adapter forced failure");
    this.name = "ForcedFailError";
  }
}

export async function* streamAnthropic(
  unified: UnifiedRequest,
  model: string,
  requestId: string = randomUUID()
): AsyncGenerator<StreamEvent> {
  if (process.env.FORCE_FAIL_PROVIDER === "anthropic") {
    throw new ForcedFailError();
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start = Date.now();

  const systemMessage = unified.messages.find((m) => m.role === "system");
  const nonSystemMessages = unified.messages.filter((m) => m.role !== "system");

  const stream = await client.messages.create({
    model,
    max_tokens: unified.max_tokens,
    ...(unified.temperature !== undefined && { temperature: unified.temperature }),
    ...(systemMessage && { system: systemMessage.content }),
    messages: nonSystemMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    stream: true,
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = "end_turn";
  let finalModel = model;

  for await (const event of stream) {
    if (event.type === "message_start") {
      inputTokens = event.message.usage.input_tokens;
      finalModel = event.message.model;
    } else if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "delta", content: event.delta.text };
    } else if (event.type === "message_delta") {
      outputTokens = event.usage.output_tokens;
      stopReason = mapStopReason(event.delta.stop_reason);
    }
  }

  yield {
    type: "done",
    stop_reason: stopReason,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCost(finalModel, inputTokens, outputTokens),
    },
    served_by: { provider: "anthropic", model: finalModel },
    failover_occurred: false,
    request_id: requestId,
    latency_ms: Date.now() - start,
  };
}

export async function callAnthropic(
  unified: UnifiedRequest,
  model: string,
  requestId: string = randomUUID()
): Promise<UnifiedResponse> {
  if (process.env.FORCE_FAIL_PROVIDER === "anthropic") {
    throw new ForcedFailError();
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start = Date.now();
  const raw = await client.messages.create(toProviderFormat(unified, model));
  const latency_ms = Date.now() - start;

  return fromProviderFormat(raw, requestId, latency_ms, false);
}
