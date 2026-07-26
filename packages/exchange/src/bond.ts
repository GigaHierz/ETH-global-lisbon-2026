// HTS ReputationBond state transitions, extracted from the HTTP handler so it can
// be unit-tested. The verifier reports each transition (active → frozen → wiped)
// after it destroys a fraudster's bond with a 2-of-2 multi-sig wipe on-chain.
// Mutates and returns the matched row, mirroring applySlash.

import type { ProviderRow, BondStatus } from "@agentrouter/shared";

export interface BondEventRequest {
  wallet?: unknown;
  bondStatus?: unknown;
  bondTokens?: unknown;
}

export type BondEventResult =
  | { ok: false; status: 400 | 404; error: string }
  | { ok: true; row: ProviderRow };

const VALID: BondStatus[] = ["active", "frozen", "wiped"];

export function applyBondEvent(list: ProviderRow[], req: BondEventRequest): BondEventResult {
  if (typeof req.wallet !== "string" || req.wallet.length === 0) {
    return { ok: false, status: 400, error: "wallet required" };
  }
  if (typeof req.bondStatus !== "string" || !VALID.includes(req.bondStatus as BondStatus)) {
    return { ok: false, status: 400, error: "bondStatus must be active|frozen|wiped" };
  }
  const wallet = req.wallet.toLowerCase();
  const row = list.find((p) => p.wallet.toLowerCase() === wallet);
  if (!row) return { ok: false, status: 404, error: "unknown provider wallet" };
  row.bondStatus = req.bondStatus as BondStatus;
  // A wipe zeroes the on-chain bond balance; an explicit count wins if provided.
  if (typeof req.bondTokens === "number" && Number.isFinite(req.bondTokens)) {
    row.bondTokens = Math.max(0, req.bondTokens);
  } else if (req.bondStatus === "wiped") {
    row.bondTokens = 0;
  }
  return { ok: true, row };
}
