// Backend URL priority: ?api=https://… query param → build-time env → Railway prod.
// The query param survives tunnel/host churn without a rebuild. Shared by every
// page so the override pattern lives in exactly one place.

export const EXCHANGE =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("api")) ||
  process.env.NEXT_PUBLIC_EXCHANGE_URL ||
  "https://exchange-production-275a.up.railway.app";

export const AGENT =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("api")) ||
  process.env.NEXT_PUBLIC_AGENT_URL ||
  "https://agent-server-production-01c6.up.railway.app";

// Every price the exchange reports is denominated in its settlement asset: USDC by
// default, HBAR behind SETTLEMENT_ASSET=hbar. See lib/settlement.ts for the live lookup.
export const DEFAULT_ASSET_SYMBOL = "$";
