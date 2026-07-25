// Hedera testnet plumbing: the only chain in this project.
// Settlement defaults to USDC (HTS 0.0.429274, 6 dp); SETTLEMENT_ASSET=hbar
// switches the whole stack back to native HBAR (asset 0.0.0, tinybar amounts).

export const HEDERA_NETWORK = "hedera:testnet";
export const HBAR_ASSET = "0.0.0";
export const TINYBAR = 100_000_000; // 1 ℏ

export const USDC_TOKEN_ID = "0.0.429274"; // Hedera testnet USDC (HTS)
export const USDC_DECIMALS = 6;

export const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

// Which asset the x402 `exact` scheme settles in. Read once at module load:
// tests that need the other branch must vi.resetModules() + re-import.
//
// Normalised rather than cast: `SETTLEMENT_ASSET=` (empty) is a normal thing to find in
// a .env, and `??` would let "" through as a live value. Only an explicit "hbar" opts
// out of USDC — anything unset, empty, or unrecognised settles in USDC.
export const SETTLEMENT_ASSET: "hbar" | "usdc" =
  (process.env.SETTLEMENT_ASSET || "").trim().toLowerCase() === "hbar" ? "hbar" : "usdc";

export const ASSET_LABEL = SETTLEMENT_ASSET === "hbar" ? "HBAR" : "USDC";
export const ASSET_SYMBOL = SETTLEMENT_ASSET === "hbar" ? "ℏ" : "$";

// Amounts for humans. The two assets read the opposite way round — a currency symbol
// leads ($0.12) while a ticker trails (0.12 ℏ) — so formatting has to branch, not just
// concatenate a symbol.
export function money(amount: number | string): string {
  return SETTLEMENT_ASSET === "hbar" ? `${amount} ℏ` : `$${amount}`;
}

// x402 price object for a native-HBAR amount, using the explicit AssetAmount form.
export function hbarPrice(hbar: number): { amount: string; asset: string } {
  return { amount: String(Math.round(hbar * TINYBAR)), asset: HBAR_ASSET };
}

// The price to hand x402 for a per-request amount, in the active settlement asset.
//
// USDC: pass the decimal through untouched. @x402/hedera's ExactHederaScheme maps a
// bare Money value to the network's default HTS token — which for hedera:testnet is
// USDC at 6 dp — so the library owns the base-unit conversion and we can't drift from
// it. HBAR has no such default (defaultMoneyConversion rejects 0.0.0 outright), so it
// must use the explicit AssetAmount form.
export function settlementPrice(amount: number): number | { amount: string; asset: string } {
  return SETTLEMENT_ASSET === "hbar" ? hbarPrice(amount) : amount;
}

// Server-side scheme config. Pins the HTS token explicitly rather than relying on the
// library's built-in testnet default, so a library change can never silently redirect
// payments to a different asset.
export const SCHEME_CONFIG =
  SETTLEMENT_ASSET === "usdc"
    ? { defaultAssets: { [HEDERA_NETWORK]: { asset: USDC_TOKEN_ID, decimals: USDC_DECIMALS } } }
    : {};

export function hashscanTx(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${txId}`;
}
export function hashscanAccount(id: string): string {
  return `https://hashscan.io/testnet/account/${id}`;
}
export function hashscanTopic(id: string): string {
  return `https://hashscan.io/testnet/topic/${id}`;
}

export type HederaRole = "AGENT" | "EXCHANGE" | "PROVIDER1" | "PROVIDER2" | "PROVIDER3" | "PROVIDER4" | "PROVIDER" | "VERIFIER" | "ESCROW";

/* v8 ignore start -- reads env + process.exit; exercised only in real mode */
export function hederaAccount(role: HederaRole): { id: string; key: string } {
  const id = process.env[`HEDERA_${role}_ID`];
  const key = process.env[`HEDERA_${role}_KEY`];
  if (!id || !key) {
    console.error(`Missing HEDERA_${role}_ID / HEDERA_${role}_KEY in .env — run \`pnpm setup-hedera\``);
    process.exit(1);
  }
  return { id, key };
}
/* v8 ignore stop */

// ── facilitator ladder ──────────────────────────────────────────────────
// Boot-time: walk the ladder, use the first /supported that serves
// hedera:testnet exact. FACILITATOR_URL env is tried first when set.

const LADDER = [
  "https://api.testnet.blocky402.com",
  "https://x402.org/facilitator",
];

let resolved: string | null = null;

/* v8 ignore start -- network I/O (facilitator ladder); real mode only */
export async function resolveFacilitator(tag = "x402"): Promise<string> {
  if (resolved) return resolved;
  const candidates = process.env.FACILITATOR_URL
    ? [process.env.FACILITATOR_URL, ...LADDER.filter((u) => u !== process.env.FACILITATOR_URL)]
    : LADDER;
  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`${url}/supported`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { kinds?: Array<{ scheme: string; network: string }> };
      const hit = body.kinds?.find((k) => k.network === HEDERA_NETWORK && k.scheme === "exact");
      if (hit) {
        console.log(`[${tag}] facilitator ladder: ${url} answered /supported (hedera:testnet exact ✓)`);
        resolved = url;
        return url;
      }
      console.warn(`[${tag}] facilitator ${url} live but no hedera:testnet exact — next rung`);
    } catch (e) {
      console.warn(`[${tag}] facilitator ${url} unreachable (${(e as Error).message}) — next rung`);
    }
  }
  throw new Error("no facilitator on the ladder serves hedera:testnet — set FACILITATOR_URL or MOCK_MODE=true");
}

// ── balances (consensus-node query via SDK: no mirror lag, free) ────────
export async function hbarBalance(accountId: string): Promise<number> {
  const { Client, AccountBalanceQuery } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet();
  try {
    const b = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
    return b.hbars.toBigNumber().toNumber();
  } finally {
    client.close();
  }
}

// USDC balance in whole tokens. Returns 0 when the account holds no USDC *and* when it
// isn't associated with the token at all — the two are indistinguishable here, so callers
// that care about the difference (settlement pre-flight) must check association separately.
export async function usdcBalance(accountId: string): Promise<number> {
  const { Client, AccountBalanceQuery, TokenId } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet();
  try {
    const b = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
    const units = b.tokens?.get(TokenId.fromString(USDC_TOKEN_ID));
    return units ? Number(units.toString()) / 10 ** USDC_DECIMALS : 0;
  } finally {
    client.close();
  }
}

// Balance in whatever asset we settle in — for wallet/budget displays.
export async function settlementBalance(accountId: string): Promise<number> {
  return SETTLEMENT_ASSET === "hbar" ? hbarBalance(accountId) : usdcBalance(accountId);
}
/* v8 ignore stop */
