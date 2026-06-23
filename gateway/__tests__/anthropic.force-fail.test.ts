import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { callAnthropic, ForcedFailError } from "../src/providers/anthropic";
import type { UnifiedRequest } from "@promptgate/shared";

const request: UnifiedRequest = {
  tier: "balanced",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 10,
  stream: false,
};

describe("FORCE_FAIL_PROVIDER=anthropic", () => {
  beforeEach(() => {
    process.env.FORCE_FAIL_PROVIDER = "anthropic";
  });

  afterEach(() => {
    delete process.env.FORCE_FAIL_PROVIDER;
  });

  it("throws ForcedFailError without calling the API", async () => {
    await expect(callAnthropic(request, "claude-sonnet-4-6")).rejects.toThrow(
      ForcedFailError
    );
  });

  it("error message identifies the provider", async () => {
    await expect(callAnthropic(request, "claude-sonnet-4-6")).rejects.toThrow(
      "FORCE_FAIL: anthropic adapter forced failure"
    );
  });
});

describe("FORCE_FAIL_PROVIDER unset", () => {
  it("does not throw ForcedFailError (env not set)", async () => {
    // Just verify the forced-fail path is not taken — we don't have a real API key
    // so the call will throw a different error (auth), not ForcedFailError
    delete process.env.FORCE_FAIL_PROVIDER;
    await expect(callAnthropic(request, "claude-sonnet-4-6")).rejects.not.toThrow(
      ForcedFailError
    );
  });
});
