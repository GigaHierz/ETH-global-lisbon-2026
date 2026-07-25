// Backend URL priority: ?api=https://… query param → build-time env → Railway prod.
// The query param survives tunnel/host churn without a rebuild. Shared by every
// page so the override pattern lives in exactly one place.

export const EXCHANGE =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("api")) ||
  process.env.NEXT_PUBLIC_EXCHANGE_URL ||
  "https://agent-router-exchange-production.up.railway.app";

export const AGENT =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("api")) ||
  process.env.NEXT_PUBLIC_AGENT_URL ||
  "https://agent-router-agent-server-production.up.railway.app";
