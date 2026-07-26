// Demo controls: restore a slashed provider to live ("un-slash") and resolve the
// canonical cheater, so a dashboard button can stage the slash story on demand and
// reset it between shows. Extracted from the HTTP handlers so it can be unit-tested.
//
// applyReset is the inverse of applySlash (slash.ts): it mutates the matched row back
// to a healthy baseline — live, full reputation, restored stake, active bond. This is
// an in-memory view change only; it performs no on-chain action (the real slash and
// its on-chain reset live in the verifier).

import { BOND_AMOUNT } from "@agentrouter/shared";
import type { ProviderRow } from "@agentrouter/shared";

// Display name of the seeded cheating provider (provider3). The staged demo targets it
// by default; DEMO_CHEATER_WALLET overrides when a deployment uses a different account.
export const DEMO_CHEATER_NAME = "SketchyGPU Labs";

// Provider quality bond restored on reset (matches the provider's boot-time STAKE_HBAR).
const DEFAULT_STAKE_HBAR = 50;

export interface ResetRequest {
  wallet?: unknown;
}

export type ResetResult =
  | { ok: false; status: 400 | 404; error: string }
  | { ok: true; row: ProviderRow };

export function applyReset(
  list: ProviderRow[],
  req: ResetRequest,
  opts: { stakeHbar?: number } = {},
): ResetResult {
  if (typeof req.wallet !== "string" || req.wallet.length === 0) {
    return { ok: false, status: 400, error: "wallet required" };
  }
  const wallet = req.wallet.toLowerCase();
  const row = list.find((p) => p.wallet.toLowerCase() === wallet);
  if (!row) return { ok: false, status: 404, error: "unknown provider wallet" };
  row.status = "live";
  row.reputation = 100;
  row.stakeHbar = opts.stakeHbar ?? DEFAULT_STAKE_HBAR;
  row.bondStatus = "active";
  row.bondTokens = BOND_AMOUNT;
  return { ok: true, row };
}

// Resolve the wallet the demo should act on: an explicit body.wallet wins, then the
// DEMO_CHEATER_WALLET env, then the seeded cheater looked up by display name. Returns
// null when nothing matches so the caller can answer 404 rather than slash the wrong row.
export function resolveCheaterWallet(list: ProviderRow[], bodyWallet?: unknown): string | null {
  if (typeof bodyWallet === "string" && bodyWallet.length > 0) return bodyWallet;
  if (process.env.DEMO_CHEATER_WALLET) return process.env.DEMO_CHEATER_WALLET;
  const row = list.find((p) => p.displayName === DEMO_CHEATER_NAME);
  return row?.wallet ?? null;
}

// Demo endpoints are guarded by a shared token when DEMO_TOKEN is set; unset means
// unguarded (local dev). The token is a low-effort deterrent for a public venue demo,
// not a real secret — see the plan/security note.
export function demoTokenOk(header: string | undefined): boolean {
  const expected = process.env.DEMO_TOKEN;
  if (!expected) return true;
  return header === expected;
}
