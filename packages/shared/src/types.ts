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

// Where a completion was actually served from (honesty marker, optional —
// absent on legacy/foreign responses). "canned" = deterministic offline fallback.
export type ServedBy = "0g" | "groq" | "canned";

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
  /** Compute source, set by our provider backends (additive; optional). */
  servedBy?: ServedBy;
  /** Upstream-reported model id, preserved verbatim (0G backend only — evidence,
   * not proof; NOT set on the groq path where the cheat-demo mask is load-bearing). */
  upstreamModel?: string;
  /** True when the 0G Compute broker returned a verifiable (TEE-attested) response
   * that we cryptographically verified — hard provenance, not just an echoed model id.
   * Only ever set on the 0G broker path. */
  teeAttested?: boolean;
  /** Opaque reference to the attestation we verified (0G broker chatID / signature digest),
   * carried through the trade record for on-chain provenance. */
  attestationRef?: string;
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
  servedBy?: ServedBy; // compute source as reported by the serving backend
  upstreamModel?: string; // upstream-reported model (0G path), preserved for provenance
  teeAttested?: boolean; // 0G broker path: response was TEE-attested and verified
  attestationRef?: string; // opaque attestation reference (0G broker chatID/signature digest)
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

// One verifier comparison. Persisted in the exchange's verify ring buffer so a
// dashboard that connects late (or reloads) can backfill the audit log, and also
// carried live over SSE as the `verify` event below.
export interface VerifyEntry {
  provider: string;
  witness: string;
  similarity: number;
  verdict: "ok" | "divergent";
}

// SSE events pushed by the exchange to the dashboard
export type ExchangeEvent =
  | { type: "request"; entry: RequestLogEntry }
  | { type: "providers"; providers: ProviderRow[] }
  | { type: "slashed"; provider: string; amountHbar: number; reason: string }
  | ({ type: "verify" } & VerifyEntry)
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
