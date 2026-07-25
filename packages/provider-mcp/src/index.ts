#!/usr/bin/env -S npx tsx
// AgentRouter Provider MCP server.
//
// Exposes the by-hand provider-onboarding steps as callable MCP tools so an agent
// can take a new provider from zero -> discoverable & serving paid inference on
// Hedera Testnet. Every tool is idempotent and returns structured errors.
//
// Transport: stdio (local). Logs go to stderr only — stdout carries the protocol.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { hashscanTx, hashscanAccount } from "@agentrouter/shared";

import { ENV_PATH, REPO_ROOT, loadEnv, readEnvVar, appendEnvLines } from "./envStore.js";
import { toErrorShape, ProvisionError } from "./errors.js";
import { getOperator, hbarBalance, createAndFundAccount, stakeToEscrow } from "./hedera.js";
import { getCacheEntry, setStaked, setRegistered, registerOnHcs, uaidFor } from "./registry.js";
import { checkEndpoint, railwayConfig } from "./deploy.js";
import { verifyLive } from "./verify.js";
import {
  HBAR_PER_ACCOUNT_DEFAULT,
  STAKE_HBAR_DEFAULT,
  DEFAULT_MODEL,
  DEFAULT_PRICE_HBAR,
  DEFAULT_ROLE,
  DEFAULT_EXCHANGE_URL,
} from "./constants.js";

const log = (...a: unknown[]) => console.error("[provider-mcp]", ...a);

// ── startup: load .env and make the registry topic id resolvable regardless of cwd ──
loadEnv();
function ensureRegistryTopic(): void {
  if (process.env.HCS_REGISTRY_TOPIC) return;
  try {
    const d = JSON.parse(readFileSync(resolve(REPO_ROOT, "deployments.json"), "utf8"));
    const t = d?.hederaTestnet?.topics?.registry;
    if (t) process.env.HCS_REGISTRY_TOPIC = t;
  } catch {
    /* getTopicId will surface a clear error if the topic truly can't be found */
  }
}
ensureRegistryTopic();

// ── result formatting ──────────────────────────────────────────────────────
type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(summary: string, structured: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(structured, null, 2)}` }],
    structuredContent: structured,
  };
}

function fail(e: unknown): ToolResult {
  const err = toErrorShape(e);
  return {
    isError: true,
    content: [{ type: "text", text: `Error [${err.code}]: ${err.message}${err.hint ? `\nHint: ${err.hint}` : ""}` }],
    structuredContent: { error: err },
  };
}

// ── core operations (shared by the individual tools AND the orchestrator) ────

function requireEscrow(): string {
  const escrow = readEnvVar("HEDERA_ESCROW_ID");
  if (!escrow) {
    throw new ProvisionError(
      "ESCROW_MISSING",
      "HEDERA_ESCROW_ID is not set",
      "Run `pnpm setup-hedera` (creates the ESCROW account) or set HEDERA_ESCROW_ID in .env.",
    );
  }
  return escrow;
}

function requireProviderAccount(role: string): { id: string; key: string } {
  const id = readEnvVar(`HEDERA_${role}_ID`);
  const key = readEnvVar(`HEDERA_${role}_KEY`);
  if (!id || !key) {
    throw new ProvisionError(
      "ACCOUNT_MISSING",
      `HEDERA_${role}_ID / HEDERA_${role}_KEY not found`,
      "Run create_provider_account first (or add the account to .env).",
    );
  }
  return { id, key };
}

async function coreCreateAccount(role: string, initialHbar: number) {
  getOperator(); // throws OPERATOR_MISSING with a hint if absent
  const existing = readEnvVar(`HEDERA_${role}_ID`);
  if (existing) {
    return {
      accountId: existing,
      evmAddress: readEnvVar(`HEDERA_${role}_EVM`) ?? null,
      role,
      alreadyExisted: true,
      hashscan: hashscanAccount(existing),
    };
  }
  const acct = await createAndFundAccount(initialHbar);
  appendEnvLines(
    [`HEDERA_${role}_ID=${acct.id}`, `HEDERA_${role}_KEY=${acct.key}`, `HEDERA_${role}_EVM=${acct.evm}`],
    `provider-mcp account (${role})`,
  );
  return {
    accountId: acct.id,
    evmAddress: acct.evm,
    role,
    fundedHbar: initialHbar,
    alreadyExisted: false,
    hashscan: hashscanAccount(acct.id),
  };
}

async function coreStake(role: string, stakeHbar: number) {
  const { id, key } = requireProviderAccount(role);
  const escrow = requireEscrow();
  const cached = getCacheEntry(id);
  if (cached.staked) {
    return { staked: true, stakeTx: cached.staked, escrow, stakeHbar, alreadyStaked: true, hashscan: hashscanTx(cached.staked) };
  }
  const stakeTx = await stakeToEscrow(id, key, escrow, stakeHbar);
  setStaked(id, stakeTx);
  return { staked: true, stakeTx, escrow, stakeHbar, alreadyStaked: false, hashscan: hashscanTx(stakeTx) };
}

async function coreDeploy(role: string, publicUrl: string, model: string, profile: string, groqKey?: string, cheat?: boolean) {
  const { id } = requireProviderAccount(role);
  const escrow = requireEscrow();
  const check = await checkEndpoint(publicUrl, model);
  const railway = railwayConfig({ profile, publicUrl, providerId: id, escrowId: escrow, groqKey, cheat });
  // remember the public URL for the registration step in this run
  if (check.reachable) process.env.PROVIDER_PUBLIC_URL = publicUrl;
  // Never throw on unreachable — the railwayConfig is exactly what the caller needs
  // to bring a box up, so it's more useful returned than swallowed.
  return {
    reachable: check.reachable,
    publicUrl,
    paywallArmed: check.paywallArmed,
    advertisedModel: check.advertisedModel,
    endpointWallet: check.wallet,
    info: check.info,
    error: check.reachable ? undefined : (check.error ?? "endpoint did not respond to /healthz + /info"),
    railwayConfig: railway,
  };
}

async function coreRegister(role: string, name: string, model: string, priceHbar: number, endpoint: string) {
  const { id, key } = requireProviderAccount(role);
  const stakeHbar = parseFloat(readEnvVar("STAKE_HBAR") ?? String(STAKE_HBAR_DEFAULT));
  const cached = getCacheEntry(id);
  if (cached.registered && cached.endpoint === endpoint) {
    return {
      registered: true,
      registrationTx: cached.registered,
      agentId: uaidFor(id),
      endpoint,
      alreadyRegistered: true,
      hashscan: hashscanTx(cached.registered),
    };
  }
  const registrationTx = await registerOnHcs({
    id,
    key,
    displayName: name,
    model,
    priceHbar,
    endpoint,
    stakeHbar,
    stakeTx: cached.staked ?? null,
  });
  setRegistered(id, registrationTx, endpoint);
  return {
    registered: true,
    registrationTx,
    agentId: uaidFor(id),
    endpoint,
    alreadyRegistered: false,
    hashscan: hashscanTx(registrationTx),
  };
}

async function coreVerify(role: string, publicUrl: string | undefined, exchangeUrl: string, timeoutMs: number, walletIn?: string) {
  const wallet = walletIn ?? readEnvVar(`HEDERA_${role}_ID`);
  if (!wallet) {
    throw new ProvisionError("WALLET_UNKNOWN", "No wallet to verify", "Pass `wallet`, or run create_provider_account first.");
  }
  const r = await verifyLive({ wallet, publicUrl, exchangeUrl, timeoutMs });
  return {
    live: r.live,
    status: r.status,
    exchangeReachable: r.exchangeReachable,
    provider: r.row,
    endpointInfoOk: r.infoOk,
    endpointInfo: r.info,
    attempts: r.attempts,
    wallet,
  };
}

// ── MCP server + tools ───────────────────────────────────────────────────────
const server = new McpServer({ name: "agentrouter-provider-mcp", version: "0.1.0" });

server.registerTool(
  "create_provider_account",
  {
    title: "Create + fund a provider Hedera account",
    description:
      "Create and fund a new Hedera Testnet account for a provider from the operator, then persist HEDERA_<role>_ID/KEY/EVM to .env. Idempotent: if the role's account already exists in .env it is returned unchanged (no new account, no spend). Use this as step 1 of provider onboarding.",
    inputSchema: {
      role: z.string().default(DEFAULT_ROLE).describe("Env role/namespace; the account is stored as HEDERA_<role>_ID/KEY/EVM. Default PROVIDER (what the `custom` provider profile reads)."),
      initialBalanceHbar: z.number().positive().max(10000).default(HBAR_PER_ACCOUNT_DEFAULT).describe("HBAR to fund the new account with from the operator."),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ role, initialBalanceHbar }) => {
    try {
      const r = await coreCreateAccount(role, initialBalanceHbar);
      return ok(r.alreadyExisted ? `Account ${r.accountId} already existed (idempotent).` : `Created + funded ${r.accountId}.`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "stake_collateral",
  {
    title: "Stake collateral to escrow",
    description:
      "Transfer the provider's staking collateral (STAKE_HBAR, default 50 ℏ) from its account to the escrow account (HEDERA_ESCROW_ID). This bond is what a verifier slashes on fraud. Idempotent via .registry-cache.json: re-runs return the existing stake tx without moving funds again.",
    inputSchema: {
      role: z.string().default(DEFAULT_ROLE).describe("Provider account role (HEDERA_<role>_ID/KEY)."),
      stakeHbar: z.number().positive().max(10000).default(STAKE_HBAR_DEFAULT).describe("Collateral amount in HBAR."),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ role, stakeHbar }) => {
    try {
      const r = await coreStake(role, stakeHbar);
      return ok(r.alreadyStaked ? `Already staked (idempotent): ${r.stakeTx}.` : `Staked ${stakeHbar} ℏ → escrow ${r.escrow}.`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "register_provider",
  {
    title: "Register HCS-14 identity on the registry topic",
    description:
      "Publish the provider's HCS-14 registration (uaid, displayName, model, priceHbar, endpoint, stakeTx) to the Hedera Consensus Service registry topic so the exchange discovers it. Idempotent: skips if already registered for the same endpoint; re-registers automatically if the endpoint changed. Requires a public endpoint (pass publicUrl or set PROVIDER_PUBLIC_URL — localhost only works if the exchange is on the same box).",
    inputSchema: {
      role: z.string().default(DEFAULT_ROLE).describe("Provider account role (HEDERA_<role>_ID/KEY)."),
      name: z.string().min(1).describe("Display name shown in the exchange routing table."),
      model: z.string().default(DEFAULT_MODEL).describe("Model you advertise — you must actually serve it (the verifier checks)."),
      priceHbar: z.number().positive().default(DEFAULT_PRICE_HBAR).describe("Price per request in HBAR."),
      publicUrl: z.string().url().optional().describe("Public endpoint to register. Falls back to PROVIDER_PUBLIC_URL if omitted."),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ role, name, model, priceHbar, publicUrl }) => {
    try {
      const endpoint = publicUrl ?? readEnvVar("PROVIDER_PUBLIC_URL");
      if (!endpoint) {
        return fail(
          new ProvisionError("PUBLIC_URL_MISSING", "No endpoint to register", "Pass publicUrl, or run deploy_provider first to attach your running endpoint."),
        );
      }
      const r = await coreRegister(role, name, model, priceHbar, endpoint);
      return ok(r.alreadyRegistered ? `Already registered for ${endpoint} (idempotent).` : `Registered ${name} on HCS for ${endpoint}.`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "deploy_provider",
  {
    title: "Attach your running provider endpoint (bring your own compute)",
    description:
      "Providers bring their own running compute. Given the public URL where your provider service is already serving, this health-checks it (/healthz, /info) and confirms the x402 paywall is armed (unpaid inference → 402), then records it as PROVIDER_PUBLIC_URL for registration. Also returns the exact Railway/VPS config (env vars + start command) for anyone who still needs to stand a box up — no Railway credentials required. Read-only against the endpoint.",
    inputSchema: {
      role: z.string().default(DEFAULT_ROLE).describe("Provider account role (used to fill the returned config)."),
      publicUrl: z.string().url().describe("Public URL where your provider service is already running."),
      model: z.string().default(DEFAULT_MODEL).describe("Model the endpoint should advertise/serve (used for the paywall probe)."),
      profile: z.string().default("custom").describe("PROVIDER_PROFILE the service runs under (custom = env-driven)."),
      groqKey: z.boolean().optional().describe("Whether a Groq key will be set (affects the returned config only)."),
      cheat: z.boolean().optional().describe("CHEAT_MODE for the returned config (leave false — honest providers pass verification)."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ role, publicUrl, model, profile, groqKey, cheat }) => {
    try {
      const r = await coreDeploy(role, publicUrl, model, profile, groqKey ? "set" : undefined, cheat);
      if (r.reachable) {
        return ok(`Endpoint ${publicUrl} is reachable and ${r.paywallArmed ? "paywall-armed" : "responding"}.`, r);
      }
      // Unreachable is a soft failure: still hand back the railwayConfig so they can deploy.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error [ENDPOINT_UNREACHABLE]: ${publicUrl} did not respond (${r.error}).\nHint: start your provider service (pnpm provider:prod) and expose it publicly — the railwayConfig below has the exact settings.\n\n${JSON.stringify(r, null, 2)}`,
          },
        ],
        structuredContent: {
          ...r,
          error: { code: "ENDPOINT_UNREACHABLE", message: `${publicUrl} did not respond`, hint: "start the provider service and expose it publicly" },
        },
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "verify_provider_live",
  {
    title: "Verify the provider is discoverable and live",
    description:
      "Poll the exchange routing table (GET /providers, Mirror-Node-backed, ~1-5s lag) until the provider's wallet shows status 'live', and probe its /info. Read-only and safe to call repeatedly. Returns live=false with the observed status ('down'/'slashed'/absent) rather than erroring, so an agent can decide what to do.",
    inputSchema: {
      role: z.string().default(DEFAULT_ROLE).describe("Provider account role — its account id is the wallet to look for."),
      wallet: z.string().optional().describe("Override the wallet (0.0.x) to look for; defaults to HEDERA_<role>_ID."),
      publicUrl: z.string().url().optional().describe("If given, also probe this endpoint's /info."),
      exchangeUrl: z.string().url().default(DEFAULT_EXCHANGE_URL).describe("Exchange base URL."),
      timeoutMs: z.number().int().min(1000).max(120000).default(30000).describe("How long to poll for 'live' before giving up."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ role, wallet, publicUrl, exchangeUrl, timeoutMs }) => {
    try {
      const r = await coreVerify(role, publicUrl, exchangeUrl, timeoutMs, wallet);
      return ok(r.live ? `LIVE: provider ${r.wallet} is in the routing table.` : `Not live yet (status: ${r.status ?? "absent"}).`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "provision_provider",
  {
    title: "Provision a provider end-to-end (orchestrator)",
    description:
      "Run the whole onboarding from one config: create+fund the account, stake collateral, attach the running endpoint, register HCS-14 identity, and verify the provider is discoverable & live. Each step is idempotent, so a re-run resumes/repairs rather than duplicating. Returns a per-step report with Hashscan links. This is the one-call path from zero → serving paid inference on Hedera Testnet.",
    inputSchema: {
      name: z.string().min(1).describe("Provider display name."),
      publicUrl: z.string().url().describe("Public URL where the provider service is (or will be) running."),
      model: z.string().default(DEFAULT_MODEL).describe("Advertised = served model."),
      priceHbar: z.number().positive().default(DEFAULT_PRICE_HBAR).describe("Price per request in HBAR."),
      role: z.string().default(DEFAULT_ROLE).describe("Env account role."),
      initialBalanceHbar: z.number().positive().max(10000).default(HBAR_PER_ACCOUNT_DEFAULT).describe("Funding for a newly created account."),
      stakeHbar: z.number().positive().max(10000).default(STAKE_HBAR_DEFAULT).describe("Collateral to stake."),
      groqKey: z.boolean().optional().describe("Whether a Groq key is configured on the box (for the deploy config)."),
      cheat: z.boolean().optional().describe("CHEAT_MODE (leave false)."),
      exchangeUrl: z.string().url().default(DEFAULT_EXCHANGE_URL).describe("Exchange base URL for the verify step."),
      requireEndpoint: z.boolean().default(true).describe("If false, skip the endpoint health-check and register anyway (useful when the box comes up after registration)."),
      verifyTimeoutMs: z.number().int().min(1000).max(120000).default(30000).describe("How long to wait for the provider to show 'live'."),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async (args) => {
    const steps: Record<string, unknown> = {};
    try {
      steps.create_provider_account = await coreCreateAccount(args.role, args.initialBalanceHbar);
      steps.stake_collateral = await coreStake(args.role, args.stakeHbar);

      if (args.requireEndpoint) {
        const dep = await coreDeploy(args.role, args.publicUrl, args.model, "custom", args.groqKey ? "set" : undefined, args.cheat);
        steps.deploy_provider = dep;
        if (!dep.reachable) {
          throw new ProvisionError(
            "ENDPOINT_UNREACHABLE",
            `Provider endpoint ${args.publicUrl} is not reachable`,
            "Start the provider service and expose it publicly (see deploy_provider.railwayConfig), then re-run provision_provider. Or pass requireEndpoint=false to register first and bring the box up after.",
          );
        }
      } else {
        steps.deploy_provider = { skipped: true, reason: "requireEndpoint=false", publicUrl: args.publicUrl };
      }

      steps.register_provider = await coreRegister(args.role, args.name, args.model, args.priceHbar, args.publicUrl);
      steps.verify_provider_live = await coreVerify(args.role, args.publicUrl, args.exchangeUrl, args.verifyTimeoutMs);

      const live = (steps.verify_provider_live as { live?: boolean }).live === true;
      const summary = live
        ? `✅ Provisioned "${args.name}" — discoverable & live on Hedera Testnet.`
        : `Provisioned "${args.name}" on-chain (account+stake+registration done). Not yet 'live' in the exchange — check the endpoint is publicly reachable and re-run verify_provider_live.`;
      return ok(summary, { provisioned: live, steps });
    } catch (e) {
      // Return what succeeded so far alongside the failure — the run is resumable.
      const err = toErrorShape(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Provisioning halted at [${err.code}]: ${err.message}${err.hint ? `\nHint: ${err.hint}` : ""}\n\nCompleted steps are idempotent — fix the issue and re-run provision_provider.` }],
        structuredContent: { provisioned: false, error: err, completedSteps: steps },
      };
    }
  },
);

// ── entrypoint ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  try {
    getOperator(); // fail fast with a clear message if the operator is unset
  } catch (e) {
    log("WARNING:", toErrorShape(e).message, "— chain tools will error until it's set.");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready (stdio). env=${ENV_PATH}`);
}

main().catch((e) => {
  log("fatal:", e);
  process.exit(1);
});
