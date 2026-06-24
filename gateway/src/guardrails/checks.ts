import type { Message } from "@promptgate/shared";
import type { GuardrailCheck, GuardrailMatch } from "./types.js";

// ── Shared PII logic ─────────────────────────────────────────────────────────

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
    pattern: /\b(\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
  {
    type: "ssn",
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  },
  {
    type: "credit_card",
    pattern: /\b(?:\d{4}[\s-]?){3}\d{1,4}\b|\b\d{13,16}\b/g,
  },
];

function redactText(content: string): { redacted: string; types: string[] } {
  let redacted = content;
  const types: string[] = [];
  for (const { type, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) => {
      if (type === "credit_card" && !luhn(match)) return match;
      types.push(type);
      return `[REDACTED:${type}]`;
    });
  }
  return { redacted, types };
}

// ── Prompt-injection patterns ────────────────────────────────────────────────

// Keep this list short and auditable — it's a heuristic, not a classifier.
const INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "instruction_override",
    pattern: /ignore\s+(previous|all|above|the\s+above|prior)\s+(instructions?|prompts?|context)/i,
  },
  {
    id: "role_reassignment",
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

// ── Check implementations ────────────────────────────────────────────────────

export const piiInputCheck: GuardrailCheck = {
  name: "pii_input",
  phase: "input",
  run({ messages = [], config = {} }) {
    const piiAction: GuardrailMatch["action"] = config.pii_action === "block" ? "blocked" : "flagged";
    const matches: GuardrailMatch[] = [];
    const updated: Message[] = messages.map((m) => ({ ...m }));

    for (let i = 0; i < updated.length; i++) {
      const { redacted, types } = redactText(updated[i].content);
      if (types.length > 0) {
        for (const t of types) {
          matches.push({ check_type: "pii", action: piiAction, pattern_type: t });
        }
        if (piiAction === "flagged") {
          updated[i] = { ...updated[i], content: redacted };
        }
      }
    }

    return { matches, messages: updated };
  },
};

export const promptInjectionCheck: GuardrailCheck = {
  name: "prompt_injection",
  phase: "input",
  run({ messages = [] }) {
    const matches: GuardrailMatch[] = [];
    const fullText = messages.map((m) => m.content).join("\n");
    for (const { id, pattern } of INJECTION_PATTERNS) {
      if (pattern.test(fullText)) {
        matches.push({ check_type: "prompt_injection", action: "flagged", pattern_type: id });
      }
    }
    return { matches, messages };
  },
};

export const piiOutputCheck: GuardrailCheck = {
  name: "pii_output",
  phase: "output",
  run({ content = "" }) {
    const { redacted, types } = redactText(content);
    const matches: GuardrailMatch[] = types.map((t) => ({
      check_type: "pii_output",
      action: "redacted" as const,
      pattern_type: t,
    }));
    return { matches, content: redacted };
  },
};
