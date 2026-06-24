import type { Message } from "@promptgate/shared";

export type GuardrailAction = "flagged" | "blocked" | "redacted";

export interface GuardrailMatch {
  check_type: string;
  action: GuardrailAction;
  pattern_type: string;
}

export interface GuardrailPayload {
  messages?: Message[];
  content?: string;
  config?: { pii_action?: "flag" | "block" };
}

export interface GuardrailRunResult {
  matches: GuardrailMatch[];
  messages?: Message[];  // returned by input checks after possible redaction
  content?: string;      // returned by output checks after possible redaction
}

export interface GuardrailCheck {
  name: string;
  phase: "input" | "output";
  run(payload: GuardrailPayload): GuardrailRunResult;
}
