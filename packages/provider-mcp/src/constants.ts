// Shared constants + defaults. Values mirror the repo's own scripts so an
// MCP-provisioned provider is indistinguishable from a hand-provisioned one.

export const HBAR_PER_ACCOUNT_DEFAULT = 100; // scripts/setup-hedera-accounts.ts
export const STAKE_HBAR_DEFAULT = 50; // packages/provider/src/registry.ts
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_PRICE_HBAR = 0.1;
export const DEFAULT_EXCHANGE_URL = "http://localhost:4100";

// A provider's account is stored under HEDERA_<ROLE>_ID/KEY/EVM. "PROVIDER" is
// the role the env-driven `custom` profile reads, so that's the default here.
export const DEFAULT_ROLE = "PROVIDER";

// MCP response guardrail (mcp-builder convention): never emit a giant blob.
export const CHARACTER_LIMIT = 25000;
