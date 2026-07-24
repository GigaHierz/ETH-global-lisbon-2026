// Provider discovery: poll each known provider URL's /info, merge into the table.
// Providers self-identify (ERC-8004 agentId included). Slashed providers stay
// slashed even if they keep answering /info.

import { log, MOCK_MODE, type ProviderInfo } from "@agentrouter/shared";
import { providers, providerList, broadcast, mockLedger } from "./state.js";

const DEFAULT_URLS = ["http://localhost:4021", "http://localhost:4022", "http://localhost:4023"];
export const PROVIDER_URLS = (process.env.PROVIDER_URLS || DEFAULT_URLS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INITIAL_STAKE_USD = 50; // mock-mode display stake; real mode reads Staking contract

export async function refreshProviders(): Promise<void> {
  await Promise.all(
    PROVIDER_URLS.map(async (url) => {
      const existing = providers.get(url);
      try {
        const res = await fetch(`${url}/info`, { signal: AbortSignal.timeout(2000) });
        const info = (await res.json()) as ProviderInfo;
        providers.set(url, {
          ...info,
          url,
          status: existing?.status === "slashed" ? "slashed" : "live",
          reputation: existing?.reputation ?? 100,
          stakeUsd: existing?.stakeUsd ?? INITIAL_STAKE_USD,
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
    log("exchange", `discovered ${live.length}/${PROVIDER_URLS.length} providers: ${live.map((p) => `${p.displayName} (${p.model} @ $${p.priceUsd})`).join(", ")}`);
  });
  setInterval(refreshProviders, 5000);
}

/** Cheapest live provider claiming the requested model. */
export function pickProvider(model: string) {
  return providerList()
    .filter((p) => p.status === "live" && p.model === model)
    .sort((a, b) => a.priceUsd - b.priceUsd)[0];
}
