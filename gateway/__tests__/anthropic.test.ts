import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { fromProviderFormat, toProviderFormat } from "../src/providers/anthropic";
import type { UnifiedRequest } from "@promptgate/shared";
import fixtures from "../src/providers/fixtures/anthropic.fixture.json";

const REQUEST_ID = "test-request-id";
const LATENCY_MS = 123;

const baseRequest: UnifiedRequest = {
  tier: "balanced",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
  max_tokens: 100,
  stream: false,
};

// Cast fixture variants to the SDK type
const asMessage = (f: unknown) => f as Anthropic.Message;

describe("toProviderFormat", () => {
  it("extracts system message into top-level system field", () => {
    const result = toProviderFormat(baseRequest, "claude-sonnet-4-6");
    expect(result.system).toBe("You are a helpful assistant.");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("omits system field when no system message", () => {
    const req: UnifiedRequest = {
      ...baseRequest,
      messages: [{ role: "user", content: "Hello" }],
    };
    const result = toProviderFormat(req, "claude-sonnet-4-6");
    expect(result.system).toBeUndefined();
  });

  it("passes temperature when provided", () => {
    const req: UnifiedRequest = { ...baseRequest, temperature: 0.7 };
    const result = toProviderFormat(req, "claude-sonnet-4-6");
    expect(result.temperature).toBe(0.7);
  });

  it("omits temperature when not provided", () => {
    const result = toProviderFormat(baseRequest, "claude-sonnet-4-6");
    expect(result.temperature).toBeUndefined();
  });

  it("sets stream: false", () => {
    const result = toProviderFormat(baseRequest, "claude-sonnet-4-6");
    expect(result.stream).toBe(false);
  });

  it("passes max_tokens", () => {
    const result = toProviderFormat(baseRequest, "claude-sonnet-4-6");
    expect(result.max_tokens).toBe(100);
  });
});

describe("fromProviderFormat — standard response", () => {
  const result = fromProviderFormat(
    asMessage(fixtures.standard),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("extracts text content", () => {
    expect(result.content).toBe("The capital of France is Paris.");
  });

  it("maps stop_reason end_turn", () => {
    expect(result.stop_reason).toBe("end_turn");
  });

  it("sets correct input_tokens (no cache tokens)", () => {
    expect(result.usage.input_tokens).toBe(14);
  });

  it("sets correct output_tokens", () => {
    expect(result.usage.output_tokens).toBe(9);
  });

  it("computes cost_usd > 0", () => {
    expect(result.usage.cost_usd).toBeGreaterThan(0);
  });

  it("sets served_by provider = anthropic", () => {
    expect(result.served_by.provider).toBe("anthropic");
  });

  it("sets served_by model", () => {
    expect(result.served_by.model).toBe("claude-sonnet-4-6");
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

describe("fromProviderFormat — cache tokens", () => {
  const result = fromProviderFormat(
    asMessage(fixtures.with_cache_tokens),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("sums input + cache_read tokens into input_tokens", () => {
    // fixture: input_tokens=5, cache_read_input_tokens=1200
    expect(result.usage.input_tokens).toBe(1205);
  });

  it("cost_usd accounts for all tokens", () => {
    expect(result.usage.cost_usd).toBeGreaterThan(0);
  });
});

describe("fromProviderFormat — max_tokens stop reason", () => {
  const result = fromProviderFormat(
    asMessage(fixtures.max_tokens),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("maps stop_reason max_tokens", () => {
    expect(result.stop_reason).toBe("max_tokens");
  });
});

describe("fromProviderFormat — tool_use stop reason", () => {
  const result = fromProviderFormat(
    asMessage(fixtures.tool_use),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("maps stop_reason tool_use", () => {
    expect(result.stop_reason).toBe("tool_use");
  });

  it("returns empty string when no text content block", () => {
    expect(result.content).toBe("");
  });
});

describe("fromProviderFormat — failover flag", () => {
  it("passes failover_occurred true when set", () => {
    const result = fromProviderFormat(
      asMessage(fixtures.standard),
      REQUEST_ID,
      LATENCY_MS,
      true
    );
    expect(result.failover_occurred).toBe(true);
  });
});
