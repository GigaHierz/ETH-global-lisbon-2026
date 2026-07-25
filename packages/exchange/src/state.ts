// In-memory exchange state: provider table, request log, reputation, mock ledger.
// No DB by design — hackathon MVP.

import { EXCHANGE_FEE_BPS, hbarOf } from "@agentrouter/shared";
import type { ProviderRow, RequestLogEntry, ExchangeEvent, ExchangeStats } from "@agentrouter/shared";

export const providers = new Map<string, ProviderRow>(); // key: provider url
export const requestLog: RequestLogEntry[] = [];
export const priceIndex: Array<{ ts: number; model: string; priceHbar: number }> = [];

// MOCK_MODE ledger: hbar balances per role/wallet
export const mockLedger = new Map<string, number>();

// ---- cumulative revenue (integer tinybars; floats only at the display edge) ----
export const revenue = {
  volumeTinybar: 0, // provider prices settled
  feeTinybar: 0, // accrued exchange fees
  requests: 0,
  refunds: 0,
  refundFailures: 0,
};

export function statsSnapshot(): ExchangeStats {
  return {
    totalVolumeHbar: hbarOf(revenue.volumeTinybar),
    requests: revenue.requests,
    feeRevenueHbar: hbarOf(revenue.feeTinybar),
    refunds: revenue.refunds,
    refundFailures: revenue.refundFailures,
    feeBps: EXCHANGE_FEE_BPS,
  };
}

// ---- SSE fanout ----
type SSEClient = { id: number; write: (chunk: string) => void };
const sseClients = new Set<SSEClient>();
let sseId = 0;

export function addSSEClient(write: (chunk: string) => void): () => void {
  const client = { id: ++sseId, write };
  sseClients.add(client);
  return () => sseClients.delete(client);
}

export function broadcast(event: ExchangeEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of sseClients) {
    try {
      c.write(payload);
    } catch {
      sseClients.delete(c);
    }
  }
}

export function providerList(): ProviderRow[] {
  return [...providers.values()];
}

export function pushRequest(entry: RequestLogEntry) {
  requestLog.push(entry);
  if (requestLog.length > 500) requestLog.shift();
  priceIndex.push({ ts: entry.ts, model: entry.model, priceHbar: entry.priceHbar });
  if (priceIndex.length > 2000) priceIndex.shift();
  broadcast({ type: "request", entry });
}
