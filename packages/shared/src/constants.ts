// Shared defaults — the single source of truth for values that used to be
// duplicated across services (exchange ask, model ids, exchange URL, provider ports).

export const DEFAULT_MODEL = "llama-3.3-70b-versatile"; // the advertised 70b
// 0G Compute Router's in-house flagship (verified live on router-api.0g.ai/v1/models 2026-07-26)
export const ZEROG_MODEL = "0gm-1.0-35b-a3b";
export const SMALL_MODEL = "llama-3.1-8b-instant"; // the cheaper 8b (what the cheater really serves)

// Flat x402 ask the agent pays the exchange per request (the exchange keeps the spread).
export const DEFAULT_EXCHANGE_ASK_HBAR = 0.12;

// Where the agent, verifier, and dashboard reach the exchange by default.
export const DEFAULT_EXCHANGE_URL = "http://localhost:4100";

// Local ports for the four provider personalities (provider1..provider4).
export const PROVIDER_PORTS = [4021, 4022, 4023, 4024] as const;

export function localhostUrl(port: number): string {
  return `http://localhost:${port}`;
}

// The exchange's discovery seed list in mock/local mode: the first three providers
// (the demo fleet). The HCS registry adds the rest in real mode.
export const DEFAULT_PROVIDER_URLS = PROVIDER_PORTS.slice(0, 3).map(localhostUrl);
