// Provider discovery: the HCS registry topic (via Mirror Node, 1-5s lag) is the
// source of truth for who exists; each entry is then probed at /info for
// liveness + current price. PROVIDER_URLS env stays as seed/fallback (and the
// only source in mock mode). Slashed providers stay slashed even if live.

import { log, MOCK_MODE, money, DEFAULT_PROVIDER_URLS, readTopicMessages, type ProviderInfo } from "@agentrouter/shared";
import { providers, providerList, broadcast, mockLedger } from "./state.js";

export const PROVIDER_URLS = (process.env.PROVIDER_URLS || DEFAULT_PROVIDER_URLS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INITIAL_STAKE_HBAR = 50; // display fallback; real entries carry stakeHbar from HCS

// endpoint → registration payload from the HCS registry topic
interface HcsReg { stakeHbar?: number; agentId?: string; displayName?: string; model?: string; price?: number; account?: string }
const hcsRegistrations = new Map<string, HcsReg>();

/* v8 ignore start -- Mirror Node + provider /info network I/O; covered via integration/demo */
async function refreshHcsRegistry(): Promise<void> {
  if (MOCK_MODE) return;
  try {
    const msgs = await readTopicMessages("registry", 50);
    for (const m of msgs) {
      const p = m.payload as ({ type?: string; endpoint?: string } & HcsReg) | null;
      if (p?.type === "registration" && p.endpoint) {
        if (!hcsRegistrations.has(p.endpoint)) log("exchange", `HCS registry: discovered ${p.agentId} @ ${p.endpoint}`);
        hcsRegistrations.set(p.endpoint, {
          stakeHbar: p.stakeHbar, agentId: p.agentId, displayName: p.displayName,
          model: p.model, price: p.price, account: p.account,
        });
      }
    }
  } catch (e) {
    log("exchange", `HCS registry read failed (${(e as Error).message.slice(0, 80)}) — using seed URLs`);
  }
}

export async function refreshProviders(): Promise<void> {
  await refreshHcsRegistry();
  const urls = [...new Set([...PROVIDER_URLS, ...hcsRegistrations.keys()])];
  await Promise.all(
    urls.map(async (url) => {
      const existing = providers.get(url);
      try {
        const res = await fetch(`${url}/info`, { signal: AbortSignal.timeout(2000) });
        const info = (await res.json()) as ProviderInfo;
        // A provider that won't quote a usable price can't be routed to: without this
        // it lands in the table with price undefined, and the cheapest-first comparator
        // in pickProvider degrades to NaN, which silently scrambles routing order.
        if (!Number.isFinite(info.price)) {
          log("exchange", `${url} /info has no usable price (${info.price}) — marking down`);
          providers.set(url, { ...info, url, price: 0, status: "down", reputation: existing?.reputation ?? 100,
            stakeHbar: existing?.stakeHbar ?? INITIAL_STAKE_HBAR, requestsServed: existing?.requestsServed ?? 0 });
          return;
        }
        providers.set(url, {
          ...info,
          url,
          status: existing?.status === "slashed" ? "slashed" : "live",
          reputation: existing?.reputation ?? 100,
          stakeHbar: existing?.stakeHbar ?? hcsRegistrations.get(url)?.stakeHbar ?? INITIAL_STAKE_HBAR,
          requestsServed: existing?.requestsServed ?? 0,
        });
        if (MOCK_MODE && !mockLedger.has(info.wallet)) mockLedger.set(info.wallet, 0);
      } catch {
        if (existing && existing.status !== "slashed") {
          providers.set(url, { ...existing, status: "down" });
        } else if (!existing && hcsRegistrations.has(url)) {
          // Registered on HCS but unreachable from here (wrong/localhost endpoint,
          // box offline, no tunnel). Show it as down instead of hiding it.
          const r = hcsRegistrations.get(url)!;
          providers.set(url, {
            displayName: r.displayName ?? url, model: r.model ?? "?", price: r.price ?? 0,
            wallet: r.account ?? "?", agentId: r.agentId ?? null, url,
            status: "down", reputation: 100, stakeHbar: r.stakeHbar ?? 0, requestsServed: 0,
          });
        }
      }
    }),
  );
  broadcast({ type: "providers", providers: providerList() });
}

export function startDiscovery() {
  refreshProviders().then(() => {
    const live = providerList().filter((p) => p.status === "live");
    log("exchange", `discovered ${live.length} providers: ${live.map((p) => `${p.displayName} (${p.model} @ ${money(p.price)})`).join(", ")}`);
  });
  setInterval(refreshProviders, 5000);
}
/* v8 ignore stop */

/**
 * Cheapest live provider claiming the requested model. Ties on price are broken
 * deterministically by url, so routing is stable regardless of discovery order
 * (two providers at the same price always resolve to the same winner).
 */
export function pickProvider(model: string) {
  return providerList()
    .filter((p) => p.status === "live" && p.model === model && Number.isFinite(p.price))
    .sort((a, b) => a.price - b.price || a.url.localeCompare(b.url))[0];
}
