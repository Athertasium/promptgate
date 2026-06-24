import { piiInputCheck, promptInjectionCheck, piiOutputCheck } from "./checks.js";
import type { GuardrailCheck } from "./types.js";

// ponytail: add check #4 = write a file implementing GuardrailCheck, add one line here
export const CHECKS: GuardrailCheck[] = [
  piiInputCheck,
  promptInjectionCheck,
  piiOutputCheck,
];
