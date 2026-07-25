// OpenAI-compatible chat types (minimal subset we actually use)
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ProviderInfo {
  displayName: string;
  model: string; // advertised model
  priceHbar: number; // per request
  wallet: string; // Hedera account id (0.0.x)
  agentId: string | null; // HCS-14 UAID (or mock)
  url: string;
}

export interface ProviderRow extends ProviderInfo {
  status: "live" | "down" | "slashed";
  reputation: number; // running score, starts 100
  stakeHbar: number;
  requestsServed: number;
}

export interface RequestLogEntry {
  id: string;
  ts: number;
  model: string;
  provider: string; // displayName
  providerUrl: string;
  priceHbar: number;
  latencyMs: number;
  paymentRef: string; // tx hash or mock ref
  promptPreview: string;
  answerPreview: string;
  status: "ok" | "error";
}

// SSE events pushed by the exchange to the dashboard
export type ExchangeEvent =
  | { type: "request"; entry: RequestLogEntry }
  | { type: "providers"; providers: ProviderRow[] }
  | { type: "slashed"; provider: string; amountHbar: number; reason: string }
  | { type: "verify"; provider: string; witness: string; similarity: number; verdict: "ok" | "divergent" };
