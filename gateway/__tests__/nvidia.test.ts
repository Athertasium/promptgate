import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { fromProviderFormat, toProviderFormat } from "../src/providers/nvidia";
import type { UnifiedRequest } from "@promptgate/shared";
import fixtures from "../src/providers/fixtures/nvidia.fixture.json";

const REQUEST_ID = "test-request-id";
const LATENCY_MS = 60;

const baseRequest: UnifiedRequest = {
  tier: "smart",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
  max_tokens: 100,
  stream: false,
};

const asCompletion = (f: unknown) => f as OpenAI.Chat.ChatCompletion;

describe("toProviderFormat — standard model", () => {
  const result = toProviderFormat(baseRequest, "deepseek-ai/deepseek-v4-flash");

  it("passes model", () => {
    expect(result.model).toBe("deepseek-ai/deepseek-v4-flash");
  });

  it("passes all messages including system", () => {
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("system");
  });

  it("passes max_tokens", () => {
    expect(result.max_tokens).toBe(100);
  });

  it("sets stream: false", () => {
    expect(result.stream).toBe(false);
  });

  it("omits temperature when not provided", () => {
    expect((result as Record<string, unknown>).temperature).toBeUndefined();
  });

  it("does not add thinking params for non-thinking model", () => {
    expect((result as Record<string, unknown>).reasoning_budget).toBeUndefined();
    expect((result as Record<string, unknown>).chat_template_kwargs).toBeUndefined();
  });
});

describe("toProviderFormat — thinking model", () => {
  const result = toProviderFormat(baseRequest, "nvidia/nemotron-3-ultra-550b-a55b");

  it("adds reasoning_budget equal to max_tokens", () => {
    expect((result as Record<string, unknown>).reasoning_budget).toBe(100);
  });

  it("adds chat_template_kwargs with enable_thinking: true", () => {
    const kwargs = (result as Record<string, unknown>).chat_template_kwargs as Record<string, unknown>;
    expect(kwargs.enable_thinking).toBe(true);
  });
});

describe("toProviderFormat — temperature", () => {
  it("passes temperature when provided", () => {
    const req: UnifiedRequest = { ...baseRequest, temperature: 0.7 };
    const result = toProviderFormat(req, "deepseek-ai/deepseek-v4-flash");
    expect((result as Record<string, unknown>).temperature).toBe(0.7);
  });
});

describe("fromProviderFormat — standard response", () => {
  const result = fromProviderFormat(asCompletion(fixtures.standard), REQUEST_ID, LATENCY_MS, false);

  it("extracts text content", () => {
    expect(result.content).toBe("The capital of France is Paris.");
  });

  it("maps finish_reason stop → end_turn", () => {
    expect(result.stop_reason).toBe("end_turn");
  });

  it("sets input_tokens from prompt_tokens", () => {
    expect(result.usage.input_tokens).toBe(5);
  });

  it("sets output_tokens from completion_tokens", () => {
    expect(result.usage.output_tokens).toBe(10);
  });

  it("computes cost_usd > 0", () => {
    expect(result.usage.cost_usd).toBeGreaterThan(0);
  });

  it("sets served_by provider = nvidia", () => {
    expect(result.served_by.provider).toBe("nvidia");
  });

  it("sets served_by model", () => {
    expect(result.served_by.model).toBe("deepseek-ai/deepseek-v4-flash");
  });

  it("sets cache_hit false", () => {
    expect(result.cache_hit).toBe(false);
  });

  it("sets failover_occurred false", () => {
    expect(result.failover_occurred).toBe(false);
  });

  it("passes through latency_ms", () => {
    expect(result.latency_ms).toBe(LATENCY_MS);
  });

  it("passes through request_id", () => {
    expect(result.request_id).toBe(REQUEST_ID);
  });
});

describe("fromProviderFormat — max_tokens stop reason", () => {
  it("maps finish_reason length → max_tokens", () => {
    const result = fromProviderFormat(asCompletion(fixtures.max_tokens), REQUEST_ID, LATENCY_MS, false);
    expect(result.stop_reason).toBe("max_tokens");
  });
});

describe("fromProviderFormat — tool_calls stop reason", () => {
  it("maps finish_reason tool_calls → tool_use", () => {
    const result = fromProviderFormat(asCompletion(fixtures.tool_calls), REQUEST_ID, LATENCY_MS, false);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("returns empty string when content is null", () => {
    const result = fromProviderFormat(asCompletion(fixtures.tool_calls), REQUEST_ID, LATENCY_MS, false);
    expect(result.content).toBe("");
  });
});

describe("fromProviderFormat — thinking model response", () => {
  const result = fromProviderFormat(asCompletion(fixtures.thinking), REQUEST_ID, LATENCY_MS, false);

  it("prepends reasoning_content wrapped in <thinking> tags", () => {
    expect(result.content).toContain("<thinking>");
    expect(result.content).toContain("The user asked a simple geography question");
    expect(result.content).toContain("</thinking>");
  });

  it("includes the answer after the thinking block", () => {
    expect(result.content).toContain("Paris is the capital of France.");
  });

  it("sets served_by model = nemotron", () => {
    expect(result.served_by.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });
});

describe("fromProviderFormat — failover flag", () => {
  it("passes failover_occurred true when set", () => {
    const result = fromProviderFormat(asCompletion(fixtures.standard), REQUEST_ID, LATENCY_MS, true);
    expect(result.failover_occurred).toBe(true);
  });
});

describe("ForcedFailError", () => {
  it("throws when FORCE_FAIL_PROVIDER=nvidia", async () => {
    const { callNvidia, ForcedFailError } = await import("../src/providers/nvidia");
    process.env.FORCE_FAIL_PROVIDER = "nvidia";
    try {
      await expect(
        callNvidia(baseRequest, "deepseek-ai/deepseek-v4-flash", "test-id")
      ).rejects.toBeInstanceOf(ForcedFailError);
    } finally {
      delete process.env.FORCE_FAIL_PROVIDER;
    }
  });
});
