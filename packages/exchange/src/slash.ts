// Slash validation, extracted from the HTTP handler so it can be unit-tested.
// Guards the two ways the raw endpoint could be abused: a missing wallet, and a
// non-positive amountHbar (a negative amount would *increase* the stake via the
// Math.max floor). Mutates and returns the matched row exactly as the handler did.

import type { ProviderRow } from "@agentrouter/shared";

export interface SlashRequest {
  wallet?: unknown;
  amountHbar?: unknown;
  reason?: unknown;
}

export type SlashResult =
  | { ok: false; status: 400 | 404; error: string }
  | { ok: true; row: ProviderRow };

export function applySlash(list: ProviderRow[], req: SlashRequest): SlashResult {
  if (typeof req.wallet !== "string" || req.wallet.length === 0) {
    return { ok: false, status: 400, error: "wallet required" };
  }
  if (typeof req.amountHbar !== "number" || !Number.isFinite(req.amountHbar) || req.amountHbar <= 0) {
    return { ok: false, status: 400, error: "amountHbar must be a positive number" };
  }
  const wallet = req.wallet.toLowerCase();
  const row = list.find((p) => p.wallet.toLowerCase() === wallet);
  if (!row) return { ok: false, status: 404, error: "unknown provider wallet" };
  row.status = "slashed";
  row.reputation = 0;
  row.stakeHbar = Math.max(0, row.stakeHbar - req.amountHbar);
  return { ok: true, row };
}
