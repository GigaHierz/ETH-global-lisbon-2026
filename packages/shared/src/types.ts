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

// A provider's HTS ReputationBond standing (fungible ARBOND token balance).
// "active" → holding its bond; "frozen" → verifier froze it on fraud (compliance
// control); "wiped" → bond destroyed by the multi-sig scheduled wipe.
export type BondStatus = "active" | "frozen" | "wiped";

export interface ProviderRow extends ProviderInfo {
  status: "live" | "down" | "slashed";
  reputation: number; // running score, starts 100
  stakeHbar: number;
  requestsServed: number;
  bondTokens: number; // HTS ReputationBond (ARBOND) balance — on-chain reputation
  bondStatus: BondStatus;
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
  isAudit?: boolean; // replay issued by the verifier — never an audit candidate itself
}

// SSE events pushed by the exchange to the dashboard
export type ExchangeEvent =
  | { type: "request"; entry: RequestLogEntry }
  | { type: "providers"; providers: ProviderRow[] }
  | { type: "slashed"; provider: string; amountHbar: number; reason: string }
  | { type: "verify"; provider: string; witness: string; similarity: number; verdict: "ok" | "divergent" }
  | {
      type: "bond";
      provider: string; // displayName
      wallet: string;
      bondTokens: number;
      bondStatus: BondStatus;
      freezeTx?: string | null;
      scheduleId?: string | null;
      wipeTx?: string | null;
    };
