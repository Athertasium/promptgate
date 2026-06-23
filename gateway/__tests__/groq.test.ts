import { describe, it, expect } from "vitest";
import type Groq from "groq-sdk";
import { fromProviderFormat, toProviderFormat } from "../src/providers/groq";
import type { UnifiedRequest } from "@promptgate/shared";
import fixtures from "../src/providers/fixtures/groq.fixture.json";

const REQUEST_ID = "test-request-id";
const LATENCY_MS = 45;

const baseRequest: UnifiedRequest = {
  tier: "fast",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
  max_tokens: 100,
  stream: false,
};

const asCompletion = (f: unknown) => f as Groq.Chat.ChatCompletion;

describe("toProviderFormat", () => {
  it("passes all messages including system", () => {
    const result = toProviderFormat(baseRequest, "llama-3.3-70b-versatile");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("user");
  });

  it("passes temperature when provided", () => {
    const req: UnifiedRequest = { ...baseRequest, temperature: 0.5 };
    const result = toProviderFormat(req, "llama-3.3-70b-versatile");
    expect(result.temperature).toBe(0.5);
  });

  it("omits temperature when not provided", () => {
    const result = toProviderFormat(baseRequest, "llama-3.3-70b-versatile");
    expect(result.temperature).toBeUndefined();
  });

  it("sets stream: false", () => {
    const result = toProviderFormat(baseRequest, "llama-3.3-70b-versatile");
    expect(result.stream).toBe(false);
  });

  it("passes max_tokens", () => {
    const result = toProviderFormat(baseRequest, "llama-3.3-70b-versatile");
    expect(result.max_tokens).toBe(100);
  });

  it("passes model", () => {
    const result = toProviderFormat(baseRequest, "llama-3.3-70b-versatile");
    expect(result.model).toBe("llama-3.3-70b-versatile");
  });
});

describe("fromProviderFormat — standard response", () => {
  const result = fromProviderFormat(
    asCompletion(fixtures.standard),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("extracts text content", () => {
    expect(result.content).toBe("The capital of France is Paris.");
  });

  it("maps finish_reason stop → end_turn", () => {
    expect(result.stop_reason).toBe("end_turn");
  });

  it("sets input_tokens from prompt_tokens", () => {
    expect(result.usage.input_tokens).toBe(14);
  });

  it("sets output_tokens from completion_tokens", () => {
    expect(result.usage.output_tokens).toBe(9);
  });

  it("computes cost_usd > 0", () => {
    expect(result.usage.cost_usd).toBeGreaterThan(0);
  });

  it("sets served_by provider = groq", () => {
    expect(result.served_by.provider).toBe("groq");
  });

  it("sets served_by model", () => {
    expect(result.served_by.model).toBe("llama-3.3-70b-versatile");
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
  const result = fromProviderFormat(
    asCompletion(fixtures.max_tokens),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("maps finish_reason length → max_tokens", () => {
    expect(result.stop_reason).toBe("max_tokens");
  });
});

describe("fromProviderFormat — tool_calls stop reason", () => {
  const result = fromProviderFormat(
    asCompletion(fixtures.tool_calls),
    REQUEST_ID,
    LATENCY_MS,
    false
  );

  it("maps finish_reason tool_calls → tool_use", () => {
    expect(result.stop_reason).toBe("tool_use");
  });

  it("returns empty string when content is null", () => {
    expect(result.content).toBe("");
  });
});

describe("fromProviderFormat — failover flag", () => {
  it("passes failover_occurred true when set", () => {
    const result = fromProviderFormat(
      asCompletion(fixtures.standard),
      REQUEST_ID,
      LATENCY_MS,
      true
    );
    expect(result.failover_occurred).toBe(true);
  });
});

describe("ForcedFailError", () => {
  it("throws when FORCE_FAIL_PROVIDER=groq", async () => {
    const { callGroq, ForcedFailError } = await import("../src/providers/groq");
    process.env.FORCE_FAIL_PROVIDER = "groq";
    try {
      await expect(
        callGroq(baseRequest, "llama-3.3-70b-versatile", "test-id")
      ).rejects.toBeInstanceOf(ForcedFailError);
    } finally {
      delete process.env.FORCE_FAIL_PROVIDER;
    }
  });
});
