// Rebuild the settlement feed from the HCS trades topic on boot.
//
// requestLog, priceIndex and the revenue counters live in process memory, so every
// restart empties the dashboard: zero volume, zero requests, an empty feed. Nothing
// is actually lost — the exchange already publishes each trade to the trades topic,
// which is immutable and on-chain — it just never read them back.
//
// This closes that loop, the same way discovery.ts already rebuilds the provider
// table from the registry topic. It also makes the "HCS is the durable record" claim
// true in practice: the ledger, not the container's uptime, is what the feed reflects.
//
// A rehydrated row is necessarily partial. The trade message records the money and the
// settlement transactions, not the prompt text or the provider's URL, so those come
// back empty and the row is tagged `restored`.

import { readTopicMessages, baseUnitsOf, type RequestLogEntry, type TopicMessage } from "@agentrouter/shared";
import { requestLog, priceIndex, revenue } from "./state.js";

/** How many trade messages to replay. The feed shows the most recent anyway. */
export const HYDRATE_LIMIT = 100;

interface TradePayload {
  type?: string;
  model?: string;
  provider?: string;
  providerAccount?: string;
  price?: number;
  fee?: number;
  total?: number;
  latencyMs?: number;
  inboundTx?: string;
  paymentTx?: string;
  ts?: number;
}

/** Consensus timestamp ("seconds.nanos") → epoch ms. */
export function consensusToMs(consensusTs: string): number {
  const seconds = Number.parseFloat(consensusTs);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

/**
 * Turn one HCS trade message into a feed row, or null if it isn't a usable trade.
 * Kept pure and separate from the network call so the shape handling is testable —
 * this parses data written by older builds too, where fields may be missing.
 */
export function tradeToEntry(msg: TopicMessage): RequestLogEntry | null {
  const p = msg.payload as TradePayload | null;
  if (p?.type !== "trade") return null;
  if (typeof p.price !== "number" || !Number.isFinite(p.price)) return null;

  const fee = typeof p.fee === "number" && Number.isFinite(p.fee) ? p.fee : 0;
  const total = typeof p.total === "number" && Number.isFinite(p.total) ? p.total : p.price + fee;
  return {
    id: `hcs-${msg.sequence}`,
    ts: typeof p.ts === "number" ? p.ts : consensusToMs(msg.consensusTs),
    model: p.model ?? "?",
    provider: p.provider ?? "?",
    providerUrl: "", // not carried on the trade message
    price: p.price,
    fee,
    total,
    latencyMs: typeof p.latencyMs === "number" ? p.latencyMs : 0,
    paymentRef: p.paymentTx ?? "-",
    inboundRef: p.inboundTx,
    promptPreview: "(restored from HCS)",
    answerPreview: "",
    status: "ok",
  };
}

/* v8 ignore start -- Mirror Node network I/O; the parsing above is what carries the logic */
/**
 * Replay the trades topic into the in-memory feed. Safe to call once at boot;
 * returns how many rows were restored. Never throws — an unreachable Mirror Node
 * should leave the exchange serving with an empty feed, not stop it booting.
 */
export async function hydrateFromTrades(): Promise<number> {
  try {
    const msgs = await readTopicMessages("trades", HYDRATE_LIMIT); // newest first
    const rows = msgs
      .map(tradeToEntry)
      .filter((e): e is RequestLogEntry => e !== null)
      .reverse(); // replay oldest → newest so the feed reads chronologically

    for (const entry of rows) {
      requestLog.push(entry);
      priceIndex.push({ ts: entry.ts, model: entry.model, price: entry.price });
      revenue.requests += 1;
      revenue.volumeUnits += baseUnitsOf(entry.price);
      revenue.feeUnits += baseUnitsOf(entry.fee);
    }
    return rows.length;
  } catch {
    return 0;
  }
}
/* v8 ignore stop */
