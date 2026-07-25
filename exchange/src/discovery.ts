// Provider discovery: the HCS registry topic (via Mirror Node, 1-5s lag) is the
// source of truth for who exists; each entry is then probed at /info for
// liveness + current price. PROVIDER_URLS env stays as seed/fallback (and the
// only source in mock mode). Slashed providers stay slashed even if live.

import { log, MOCK_MODE, readTopicMessages, type ProviderInfo } from "@agentrouter/shared";
import { providers, providerList, broadcast, mockLedger } from "./state.js";

const DEFAULT_URLS = ["http://localhost:4021", "http://localhost:4022", "http://localhost:4023"];
export const PROVIDER_URLS = (process.env.PROVIDER_URLS || DEFAULT_URLS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INITIAL_STAKE_HBAR = 50; // display fallback; real entries carry stakeHbar from HCS

// endpoint → registration payload from the HCS registry topic
const hcsRegistrations = new Map<string, { stakeHbar?: number; agentId?: string }>();

async function refreshHcsRegistry(): Promise<void> {
  if (MOCK_MODE) return;
  try {
    const msgs = await readTopicMessages("registry", 50);
    for (const m of msgs) {
      const p = m.payload as { type?: string; endpoint?: string; stakeHbar?: number; agentId?: string } | null;
      if (p?.type === "registration" && p.endpoint) {
        if (!hcsRegistrations.has(p.endpoint)) log("exchange", `HCS registry: discovered ${p.agentId} @ ${p.endpoint}`);
        hcsRegistrations.set(p.endpoint, { stakeHbar: p.stakeHbar, agentId: p.agentId });
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
        }
      }
    }),
  );
  broadcast({ type: "providers", providers: providerList() });
}

export function startDiscovery() {
  refreshProviders().then(() => {
    const live = providerList().filter((p) => p.status === "live");
    log("exchange", `discovered ${live.length} providers: ${live.map((p) => `${p.displayName} (${p.model} @ ${p.priceHbar} ℏ)`).join(", ")}`);
  });
  setInterval(refreshProviders, 5000);
}

/** Cheapest live provider claiming the requested model. */
export function pickProvider(model: string) {
  return providerList()
    .filter((p) => p.status === "live" && p.model === model)
    .sort((a, b) => a.priceHbar - b.priceHbar)[0];
}
