// Shared constants + defaults. Values mirror the repo's own scripts so an
// MCP-provisioned provider is indistinguishable from a hand-provisioned one.

import { ZEROG_MODEL } from "@agentrouter/shared";

export const HBAR_PER_ACCOUNT_DEFAULT = 100; // scripts/setup-hedera-accounts.ts
export const STAKE_HBAR_DEFAULT = 50; // packages/provider/src/registry.ts

// Supply backend defaults. 0G Compute is the code default for bring-your-own
// providers (packages/provider/src/backends/index.ts DEFAULT_BACKEND = "0g" and
// customProfile() serving ZEROG_MODEL), so the MCP recommends it too. groq and
// canned stay first-class alternatives.
export const DEFAULT_BACKEND = "0g" as const;
// Advertised = served model for the default (0G) backend. Matches what the
// `custom` profile serves when PROVIDER_BACKEND is unset/0g.
export const DEFAULT_MODEL = ZEROG_MODEL; // "0gm-1.0-35b-a3b"
// The Groq/llama model, for providers that pick the groq backend instead.
export const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_PRICE = 0.1;
export const DEFAULT_EXCHANGE_URL = "http://localhost:4100";

// A provider's account is stored under HEDERA_<ROLE>_ID/KEY/EVM. "PROVIDER" is
// the role the env-driven `custom` profile reads, so that's the default here.
export const DEFAULT_ROLE = "PROVIDER";

// MCP response guardrail (mcp-builder convention): never emit a giant blob.
export const CHARACTER_LIMIT = 25000;
