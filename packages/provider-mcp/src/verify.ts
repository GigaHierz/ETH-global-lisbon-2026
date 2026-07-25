// Confirm a provider is discoverable + serving: poll the exchange routing table
// (GET /providers via Mirror-Node-backed discovery, ~1-5s lag) until the wallet
// shows status "live", and probe the provider's own /info. Read-only.

import { DEFAULT_EXCHANGE_URL } from "./constants.js";

export interface ProviderRow {
  displayName: string;
  model: string;
  priceHbar: number;
  wallet: string;
  status: "live" | "down" | "slashed";
  stakeHbar?: number;
  reputation?: number;
  url?: string;
}

export interface VerifyResult {
  live: boolean;
  status: string | null;
  row: ProviderRow | null;
  infoOk: boolean;
  info: unknown;
  attempts: number;
  exchangeReachable: boolean;
}

const trim = (u: string) => u.replace(/\/+$/, "");

export async function verifyLive(opts: {
  wallet: string;
  publicUrl?: string;
  exchangeUrl?: string;
  timeoutMs?: number;
}): Promise<VerifyResult> {
  const exchange = trim(opts.exchangeUrl || DEFAULT_EXCHANGE_URL);
  const deadline = Date.now() + (opts.timeoutMs ?? 30000);
  const wallet = opts.wallet.toLowerCase();

  let attempts = 0;
  let row: ProviderRow | null = null;
  let exchangeReachable = false;

  while (Date.now() < deadline) {
    attempts++;
    try {
      const res = await fetch(`${exchange}/providers`, { signal: AbortSignal.timeout(4000) });
      exchangeReachable = true;
      const list = (await res.json()) as ProviderRow[];
      row = list.find((p) => p.wallet?.toLowerCase() === wallet) ?? null;
      if (row?.status === "live") break;
    } catch {
      /* exchange not up yet or transient — retry until deadline */
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  let infoOk = false;
  let info: unknown = null;
  if (opts.publicUrl) {
    try {
      const r = await fetch(`${trim(opts.publicUrl)}/info`, { signal: AbortSignal.timeout(4000) });
      infoOk = r.ok;
      info = await r.json().catch(() => null);
    } catch {
      /* endpoint unreachable */
    }
  }

  return {
    live: row?.status === "live",
    status: row?.status ?? null,
    row,
    infoOk,
    info,
    attempts,
    exchangeReachable,
  };
}
