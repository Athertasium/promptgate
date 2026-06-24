import type { Message, UnifiedRequest } from "@promptgate/shared";

// ── Types ───────────────────────────────────────────────────────────────────

export type GuardrailAction = "flagged" | "blocked" | "redacted";
export type CheckType = "pii" | "prompt_injection" | "pii_output";

export interface GuardrailMatch {
  check_type: CheckType;
  action: GuardrailAction;
  pattern_type: string; // logged to guardrail_events.detail — never the raw matched text
}

export interface GuardrailResult {
  passed: boolean;       // false when any match action = "blocked"
  matches: GuardrailMatch[];
  messages: Message[];   // original messages, or redacted copies when PII flagged
}

export interface GuardrailConfig {
  pii_action?: "flag" | "block"; // default: "flag"
}

// ── PII patterns ─────────────────────────────────────────────────────────────

// ponytail: Luhn check keeps false-positive rate low without adding a library
function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const PII_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  {
    type: "email",
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  },
  {
    type: "phone_us",
    // matches: (555) 867-5309 | 555-867-5309 | 5558675309 | +1 555 867 5309
    pattern: /\b(\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
  {
    type: "ssn",
    // matches: 123-45-6789 | 123 45 6789 | 123456789
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  },
  {
    type: "credit_card",
    // matches 13–16 digit groups in common formats; Luhn-validated below
    pattern: /\b(?:\d{4}[\s-]?){3}\d{1,4}\b|\b\d{13,16}\b/g,
  },
];

function redactMessage(content: string): { redacted: string; types: string[] } {
  let redacted = content;
  const types: string[] = [];

  for (const { type, pattern } of PII_PATTERNS) {
    // Reset lastIndex for global regexes each pass
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) => {
      if (type === "credit_card" && !luhn(match)) return match;
      types.push(type);
      return `[REDACTED:${type}]`;
    });
  }

  return { redacted, types };
}

// ── Prompt-injection patterns ─────────────────────────────────────────────────

// Keep this list short and auditable — it's a heuristic, not a classifier.
// False positives are expected; v1 only flags, never blocks on these.
const INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "instruction_override",
    pattern: /ignore\s+(previous|all|above|the\s+above|prior)\s+(instructions?|prompts?|context)/i,
  },
  {
    id: "role_reassignment",
    // "you are now X" is unambiguous; "act as" narrowed to AI/model roles to avoid
    // false positives on natural usage like "act as a proxy" in technical context
    // optional adjective word before role catches "act as an uncensored model"
    pattern: /\byou\s+are\s+now\s+(?:a|an|the)\s+\w+|\bact\s+as\s+(?:a|an|the)\s+(?:\w+\s+)?(?:assistant|ai|model|bot|system|character|human|person|expert|hacker)/i,
  },
  {
    id: "new_instructions",
    pattern: /\bnew\s+(role|persona|instructions?|system\s+prompt)\b/i,
  },
  {
    id: "disregard",
    pattern: /\bdisregard\s+(previous|all|above|prior)\b/i,
  },
  {
    id: "forget_instructions",
    pattern: /\bforget\s+(everything|your\s+instructions?|previous\s+instructions?|all\s+previous)\b/i,
  },
  {
    id: "delimiter_injection",
    // Adversarial delimiter sequences used to confuse system/user boundary
    pattern: /^#{3,}|^-{3,}|^\[INST\]|^<\|im_start\|>/m,
  },
  {
    id: "true_instructions",
    pattern: /\byour\s+(real|true|actual)\s+instructions?\b/i,
  },
  {
    id: "jailbreak",
    pattern: /\bjailbreak\b|\bdo\s+anything\s+now\b|\bDAN\b/,
  },
];

// ── Output PII check ──────────────────────────────────────────────────────────

export interface OutputPIIResult {
  content: string;        // redacted content (unchanged if no PII found)
  matches: GuardrailMatch[];
}

export function checkOutputPII(content: string): OutputPIIResult {
  const { redacted, types } = redactMessage(content);
  const matches: GuardrailMatch[] = types.map((t) => ({
    check_type: "pii_output",
    action: "redacted",
    pattern_type: t,
  }));
  return { content: redacted, matches };
}

// ── Main check ────────────────────────────────────────────────────────────────

export function checkGuardrails(
  req: UnifiedRequest,
  config: GuardrailConfig = {}
): GuardrailResult {
  const piiAction: GuardrailAction = config.pii_action === "block" ? "blocked" : "flagged";
  const matches: GuardrailMatch[] = [];
  const messages: Message[] = req.messages.map((msg) => ({ ...msg }));

  // PII check
  for (let i = 0; i < messages.length; i++) {
    const { redacted, types } = redactMessage(messages[i].content);
    if (types.length > 0) {
      for (const t of types) {
        matches.push({ check_type: "pii", action: piiAction, pattern_type: t });
      }
      if (piiAction === "flagged") {
        messages[i] = { ...messages[i], content: redacted };
      }
    }
  }

  // Prompt-injection check (flag-only in v1)
  const fullText = req.messages.map((m) => m.content).join("\n");
  for (const { id, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(fullText)) {
      matches.push({ check_type: "prompt_injection", action: "flagged", pattern_type: id });
    }
  }

  const passed = !matches.some((m) => m.action === "blocked");
  return { passed, matches, messages };
}
