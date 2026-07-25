// Hedera testnet plumbing: the only chain in this project.
// Settlement is native HBAR (asset 0.0.0, tinybar amounts).

export const HEDERA_NETWORK = "hedera:testnet";
export const HBAR_ASSET = "0.0.0";
export const TINYBAR = 100_000_000; // 1 ℏ

export const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

// x402 price object for a native-HBAR amount, using the explicit AssetAmount form.
export function hbarPrice(hbar: number): { amount: string; asset: string } {
  return { amount: String(Math.round(hbar * TINYBAR)), asset: HBAR_ASSET };
}

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
/* v8 ignore stop */
