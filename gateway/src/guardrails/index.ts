import type { Message } from "@promptgate/shared";
import type { UnifiedRequest } from "@promptgate/shared";
import { CHECKS } from "./registry.js";

export type { GuardrailCheck, GuardrailMatch, GuardrailAction } from "./types.js";

// ── Public API (backward-compatible with v1 callers) ─────────────────────────

export type CheckType = "pii" | "prompt_injection" | "pii_output";

export interface GuardrailConfig {
  pii_action?: "flag" | "block";
}

export interface GuardrailResult {
  passed: boolean;
  matches: Array<{ check_type: string; action: string; pattern_type: string }>;
  messages: Message[];
}

export interface OutputPIIResult {
  content: string;
  matches: Array<{ check_type: string; action: string; pattern_type: string }>;
}

export function checkGuardrails(req: UnifiedRequest, config: GuardrailConfig = {}): GuardrailResult {
  const inputChecks = CHECKS.filter((c) => c.phase === "input");
  let messages: Message[] = req.messages.map((m) => ({ ...m }));
  const allMatches: GuardrailResult["matches"] = [];

  for (const check of inputChecks) {
    const result = check.run({ messages, config });
    allMatches.push(...result.matches);
    if (result.messages) messages = result.messages;
  }

  const passed = !allMatches.some((m) => m.action === "blocked");
  return { passed, matches: allMatches, messages };
}

export function checkOutputPII(content: string): OutputPIIResult {
  const outputChecks = CHECKS.filter((c) => c.phase === "output");
  let current = content;
  const allMatches: OutputPIIResult["matches"] = [];

  for (const check of outputChecks) {
    const result = check.run({ content: current });
    allMatches.push(...result.matches);
    if (result.content !== undefined) current = result.content;
  }

  return { content: current, matches: allMatches };
}
