export type Tier = "fast" | "balanced" | "smart";

export type Provider = "openai" | "anthropic" | "groq";

export type MessageRole = "system" | "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
}

export interface UnifiedToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface UnifiedTool {
  type: "function";
  function: UnifiedToolFunction;
}

export interface UnifiedRequest {
  tier: Tier;
  messages: Message[];
  max_tokens: number;
  temperature?: number;
  tools?: UnifiedTool[];
  stream: false;
  metadata?: {
    caller_id?: string;
    tags?: string[];
  };
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export type StopReason = "end_turn" | "max_tokens" | "tool_use" | "content_filter";

export interface ServedBy {
  provider: Provider;
  model: string;
}

export interface UnifiedResponse {
  content: string;
  stop_reason: StopReason;
  usage: TokenUsage;
  served_by: ServedBy;
  failover_occurred: boolean;
  cache_hit: boolean;
  latency_ms: number;
  request_id: string;
}

export interface ProviderError {
  provider: Provider;
  status: number;
  message: string;
  retryable: boolean;
}
