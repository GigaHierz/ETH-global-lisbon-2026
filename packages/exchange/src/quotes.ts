// Quote pinning for the dynamic 402 flow.
//
// The exchange's x402 price depends on routing (model → cheapest live provider),
// so each unpaid request gets a per-request quote: route, compute fee, cache.
// The paid retry carries the same body, so we key quotes on a hash of
// {model, messages} — the retry recomputes the SAME pinned price even if
// provider prices changed in between, which is what makes the agent's signed
// payment verify. Expired or unknown → fresh 402 (the client just retries).

import { createHash } from "node:crypto";
import { feeForPrice, baseUnitsOf, type ChatCompletionRequest } from "@agentrouter/shared";
import type { ProviderRow } from "@agentrouter/shared";

export const QUOTE_TTL_MS = 60_000;

export interface Quote {
  quoteId: string;
  bodyKey: string;
  providerUrl: string;
  providerName: string;
  // Integer base units of the active settlement asset (tinybar under HBAR,
  // micro-USDC under USDC) — never floats, so a quote can't drift by a rounding step.
  priceUnits: number; // provider's listed price — the provider receives exactly this
  feeUnits: number; // ceil(price * FEE_BPS / 10000) — the exchange keeps this
  totalUnits: number; // what the agent pays the exchange
  expiresAt: number;
}

const quotes = new Map<string, Quote>(); // bodyKey → quote
const byId = new Map<string, Quote>(); // quoteId → quote

export function bodyKey(body: ChatCompletionRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ model: body.model, messages: body.messages }))
    .digest("hex")
    .slice(0, 24);
}

/** Pinned quote for this body if one is still fresh; otherwise create one from the routed provider. */
export function quoteFor(body: ChatCompletionRequest, provider: ProviderRow | undefined, feeBps: number): Quote | null {
  const key = bodyKey(body);
  const existing = quotes.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing;
  if (existing) {
    quotes.delete(key);
    byId.delete(existing.quoteId);
  }
  if (!provider) return null;
  const priceUnits = baseUnitsOf(provider.price);
  const feeUnits = feeForPrice(priceUnits, feeBps);
  const quote: Quote = {
    quoteId: `q-${Date.now().toString(36)}-${key.slice(0, 8)}`,
    bodyKey: key,
    providerUrl: provider.url,
    providerName: provider.displayName,
    priceUnits,
    feeUnits,
    totalUnits: priceUnits + feeUnits,
    expiresAt: Date.now() + QUOTE_TTL_MS,
  };
  quotes.set(key, quote);
  byId.set(quote.quoteId, quote);
  return quote;
}

/** Look up the pinned quote for a paid retry (no creation). */
export function pinnedQuote(body: ChatCompletionRequest): Quote | null {
  const q = quotes.get(bodyKey(body));
  return q && q.expiresAt > Date.now() ? q : null;
}

export function quoteById(quoteId: string): Quote | null {
  const q = byId.get(quoteId);
  return q && q.expiresAt > Date.now() ? q : null;
}

/** A quote is single-settlement: drop it once its trade completes. */
export function consumeQuote(quote: Quote): void {
  quotes.delete(quote.bodyKey);
  byId.delete(quote.quoteId);
}
