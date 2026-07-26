// In-memory exchange state: provider table, request log, reputation, mock ledger.
// No DB by design — hackathon MVP.

import { EXCHANGE_FEE_BPS, ASSET_LABEL, REQUEST_LOG_LIMIT, fromBaseUnits } from "@agentrouter/shared";
import type { ProviderRow, RequestLogEntry, ExchangeEvent, ExchangeStats, VerifyEntry } from "@agentrouter/shared";

export const providers = new Map<string, ProviderRow>(); // key: provider url
export const requestLog: RequestLogEntry[] = [];
export const priceIndex: Array<{ ts: number; model: string; price: number }> = [];
// Verifier comparisons, oldest→newest. Kept so a dashboard that connects after
// an audit fired (or reloads) can backfill via GET /verifies instead of showing
// an empty log until the next live event happens to land.
export const verifyLog: VerifyEntry[] = [];
const VERIFY_LOG_LIMIT = 50;

// MOCK_MODE ledger: hbar balances per role/wallet
export const mockLedger = new Map<string, number>();

// ---- cumulative revenue (integer base units; floats only at the display edge) ----
export const revenue = {
  volumeUnits: 0, // provider prices settled
  feeUnits: 0, // accrued exchange fees
  requests: 0,
  refunds: 0,
  refundFailures: 0,
};

export function statsSnapshot(): ExchangeStats {
  return {
    totalVolume: fromBaseUnits(revenue.volumeUnits),
    requests: revenue.requests,
    feeRevenue: fromBaseUnits(revenue.feeUnits),
    refunds: revenue.refunds,
    refundFailures: revenue.refundFailures,
    feeBps: EXCHANGE_FEE_BPS,
    asset: ASSET_LABEL,
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
  if (requestLog.length > REQUEST_LOG_LIMIT) requestLog.shift();
  priceIndex.push({ ts: entry.ts, model: entry.model, price: entry.price });
  if (priceIndex.length > 2000) priceIndex.shift();
  broadcast({ type: "request", entry });
}

export function pushVerify(entry: VerifyEntry) {
  verifyLog.push(entry);
  if (verifyLog.length > VERIFY_LOG_LIMIT) verifyLog.shift();
  broadcast({ type: "verify", ...entry });
}
