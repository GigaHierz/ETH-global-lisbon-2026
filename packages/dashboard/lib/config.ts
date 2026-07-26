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
  "https://agent-server-production-6029.up.railway.app";

// Verifier control surface — used by the demo "Real on-chain slash" button. Overridable
// per-tab with ?vapi= (mirrors the ?api= pattern) so it survives host churn at a venue.
export const VERIFIER =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("vapi")) ||
  process.env.NEXT_PUBLIC_VERIFIER_URL ||
  "https://verifier-production.up.railway.app";

// Shared token for the guarded /demo/* endpoints. Public by nature (ships to the browser)
// — a casual-abuse deterrent at the venue, not a real secret. Empty ⇒ endpoints unguarded.
export const DEMO_TOKEN =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demoToken")) ||
  process.env.NEXT_PUBLIC_DEMO_TOKEN ||
  "";

// Every price the exchange reports is denominated in its settlement asset: USDC by
// default, HBAR behind SETTLEMENT_ASSET=hbar. See lib/settlement.ts for the live lookup.
export const DEFAULT_ASSET_SYMBOL = "$";
