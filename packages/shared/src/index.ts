export * from "./types.js";
export * from "./constants.js";
export * from "./canned.js";
export * from "./hedera.js";

export const MOCK_MODE = process.env.MOCK_MODE === "true";

// Header used in MOCK_MODE instead of real x402 payment: carries the USD amount
// the caller "pays". Providers verify presence + amount; the exchange keeps the ledger.
export const MOCK_PAYMENT_HEADER = "x-mock-payment";
export const MOCK_PAYMENT_REF_HEADER = "x-mock-payment-ref";

// Set on every replay the verifier issues. Anything served under this header is
// verifier traffic, so it is logged as isAudit and can never be picked as a
// future audit candidate (an audit of an audit proves nothing).
export const AUDIT_REQUEST_HEADER = "x-agentrouter-audit";

export function log(tag: string, ...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}]`, ...args);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}
export * from "./hcs.js";
export * from "./hts.js";
