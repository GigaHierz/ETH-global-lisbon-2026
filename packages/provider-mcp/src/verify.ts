// Confirm a provider is discoverable + serving: poll the exchange routing table
// (GET /providers via Mirror-Node-backed discovery, ~1-5s lag) until the wallet
// shows status "live", and probe the provider's own /info. Read-only.

// ProviderRow is the exchange's own row shape — import it rather than restating it,
// or fields the exchange adds (agentId, requestsServed) go missing from our types.
import type { ProviderRow } from "@agentrouter/shared";
import { DEFAULT_EXCHANGE_URL } from "./constants.js";

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

/**
 * Choose the row that describes *this* provider.
 *
 * The exchange keys its table by **url**, not by wallet, so one wallet legitimately
 * has several rows — every endpoint change (tunnel restart, move to a VPS) leaves
 * the old url behind as a stale `down` row. Taking the first wallet match would
 * then report `down` for a provider that is actually live. Prefer the row for the
 * endpoint we were asked about, then any live row, and only then fall back.
 */
export function pickRow(list: ProviderRow[], wallet: string, publicUrl?: string): ProviderRow | null {
  const mine = list.filter((p) => p.wallet?.toLowerCase() === wallet.toLowerCase());
  if (!mine.length) return null;
  if (publicUrl) {
    const exact = mine.find((p) => p.url && trim(p.url) === trim(publicUrl));
    if (exact) return exact;
  }
  return mine.find((p) => p.status === "live") ?? mine[0];
}

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
      row = pickRow(list, wallet, opts.publicUrl);
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
