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
  price: number; // per request
  wallet: string; // Hedera account id (0.0.x)
  agentId: string | null; // HCS-14 UAID (or mock)
  url: string;
}

// A provider's HTS ReputationBond standing (fungible ARBOND token balance).
// "active" → holding its bond; "frozen" → verifier froze it on fraud (compliance
// control); "wiped" → bond destroyed by the 2-of-2 multi-sig wipe.
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
  price: number; // provider's listed price (what the provider receives)
  fee: number; // exchange fee on top (EXCHANGE_FEE_BPS of price, ceil in base units)
  total: number; // what the agent pays the exchange (price + fee)
  latencyMs: number;
  paymentRef: string; // exchange→provider settle tx (or mock ref)
  inboundRef?: string; // agent→exchange settle tx (or mock ref), set post-settlement
  refundRef?: string; // refund tx when a settled payment was refunded after provider failure
  promptPreview: string;
  answerPreview: string;
  status: "ok" | "error" | "refunded";
  isAudit?: boolean; // replay issued by the verifier — never an audit candidate itself
}

// Cumulative exchange revenue/refund stats (served by GET /stats)
export interface ExchangeStats {
  totalVolume: number; // sum of provider prices settled
  requests: number; // successful routed requests
  feeRevenue: number; // accrued exchange fees (ceil-rounded base units, shown as a decimal)
  refunds: number; // refunded trades
  refundFailures: number; // refunds that themselves failed (logged loudly)
  feeBps: number; // active EXCHANGE_FEE_BPS
  asset: string; // what every amount above is denominated in (USDC / HBAR)
}

// SSE events pushed by the exchange to the dashboard
export type ExchangeEvent =
  | { type: "request"; entry: RequestLogEntry }
  | { type: "providers"; providers: ProviderRow[] }
  | { type: "slashed"; provider: string; amountHbar: number; reason: string }
  | { type: "verify"; provider: string; witness: string; similarity: number; verdict: "ok" | "divergent" }
  | { type: "stats"; stats: ExchangeStats }
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
