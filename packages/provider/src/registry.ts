// Provider identity + staking (no-Solidity path).
// Real mode, on boot (idempotent — see the note on durability below):
//   1. stake STAKE_HBAR (default 50 ℏ) → the verifier-held escrow account
//   2. publish an HCS-14-style registration JSON to the HCS registry topic
//      (HCS-14 universal agent id + hcs14 profile block)
// Mock mode: fabricated identity, no network.

import fs from "node:fs";
import path from "node:path";
import {
  hederaAccount,
  publishToTopic,
  hashscanTx,
  log,
  ASSET_LABEL,
  MOCK_MODE,
  bondTokenId,
  bondBalance,
  readTopicMessages,
} from "@agentrouter/shared";
import type { ProviderProfile } from "./profiles.js";

const CACHE_FILE = path.join(process.cwd(), ".registry-cache.json");
const STAKE_HBAR = parseFloat(process.env.STAKE_HBAR || "50");

interface CacheEntry {
  staked?: string; // stake tx id
  registered?: string; // registration HCS tx id
  endpoint?: string; // endpoint we registered with (re-register if it changes)
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(c: Record<string, CacheEntry>) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
  } catch {
    /* read-only or ephemeral filesystem — the registry topic is the real record */
  }
}

/** Has this account already registered (and therefore staked)? Answered from the HCS
 *  registry topic, which is the durable record — the local cache file is only a way
 *  to skip this lookup.
 *
 *  This matters on any host with an ephemeral filesystem. A container starts with no
 *  cache file, concludes it has never staked, and transfers STAKE_HBAR again — so
 *  every redeploy silently costs another 50 ℏ until the account is drained and its
 *  HCS publishes start failing. Asking the chain makes staking idempotent across
 *  restarts, rebuilds and hosts. */
async function onChainRegistration(account: string): Promise<CacheEntry | null> {
  try {
    const msgs = await readTopicMessages("registry", 100); // newest first
    let found: CacheEntry | null = null;
    for (const m of msgs) {
      const p = m.payload as { type?: string; account?: string; endpoint?: string; stakeTx?: string | null } | null;
      if (p?.type !== "registration" || p.account !== account) continue;
      // The newest message wins for endpoint/registration state...
      found ??= { registered: `hcs-seq-${m.sequence}`, endpoint: p.endpoint };
      // ...but the stake is a one-time event that may predate it. A later
      // re-registration (an endpoint change, say) can carry stakeTx: null while the
      // collateral is still sitting in escrow, so keep scanning back for the message
      // that recorded it. Taking only the newest here is what re-staked 50 HBAR.
      if (p.stakeTx) {
        found.staked = p.stakeTx;
        break;
      }
    }
    return found;
  } catch {
    /* Mirror Node unreachable — fall through and let the cache decide */
  }
  return null;
}

/** An endpoint only the local box can reach — useless to a remote exchange. */
export function isLocal(url: string | undefined): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url ?? "");
}

async function stakeToEscrow(id: string, key: string): Promise<string> {
  const { Client, AccountId, PrivateKey, Hbar, TransferTransaction } = await import("@hiero-ledger/sdk");
  const escrow = process.env.HEDERA_ESCROW_ID;
  if (!escrow) throw new Error("HEDERA_ESCROW_ID missing — run pnpm setup-hedera");
  const client = Client.forTestnet().setOperator(AccountId.fromString(id), PrivateKey.fromStringECDSA(key));
  try {
    const tx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(id), new Hbar(-STAKE_HBAR))
      .addHbarTransfer(AccountId.fromString(escrow), new Hbar(STAKE_HBAR))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } finally {
    client.close();
  }
}

/** Wallet + agent id with no network calls — an env read and a template string.
 *  Lets the server bind its port and answer /info before the slow on-chain work
 *  (staking, HCS registration) has finished. */
export function providerIdentity(profile: ProviderProfile): { wallet: string; agentId: string } {
  if (MOCK_MODE) return { wallet: `0.0.mock-${profile.key}`, agentId: `mock-${profile.key}` };
  const { id } = hederaAccount(profile.hederaRole);
  return { wallet: id, agentId: `uaid:aid:hedera:testnet:${id}` };
}

export async function ensureRegistered(
  profile: ProviderProfile,
): Promise<{ wallet: string; agentId: string | null; key: string }> {
  if (MOCK_MODE) {
    const agentId = `mock-${profile.key}`;
    log(profile.key, `MOCK registry: agentId=${agentId}`);
    return { wallet: `0.0.mock-${profile.key}`, agentId, key: "" };
  }

  const { id, key } = hederaAccount(profile.hederaRole);
  const agentId = `uaid:aid:hedera:testnet:${id}`; // HCS-14-style universal agent id
  // Remote boxes MUST set PROVIDER_PUBLIC_URL (tunnel/VPS address) — the exchange
  // reaches you at the endpoint you register, and localhost only works on its box.
  const endpoint = process.env.PROVIDER_PUBLIC_URL ?? `http://localhost:${profile.port}`;
  const cache = readCache();
  // Local cache first (fast, no network); otherwise ask the chain, so a fresh
  // container does not re-stake just because it has no file.
  let entry: CacheEntry = cache[id] ?? {};
  if (!entry.staked && !entry.registered) {
    const onChain = await onChainRegistration(id);
    if (onChain) {
      entry = onChain;
      log(profile.key, `found an existing registration on the HCS registry topic — not re-staking`);
    }
  }
  if (entry.registered && entry.endpoint !== endpoint) {
    // Never downgrade a public registration to localhost. Booting in a shell that lost
    // PROVIDER_PUBLIC_URL would otherwise publish localhost over the good registration
    // and the exchange — which reads the topic last-write-wins — would mark us down.
    if (isLocal(endpoint) && !isLocal(entry.endpoint)) {
      log(
        profile.key,
        `WARN PROVIDER_PUBLIC_URL is unset, so this boot would register ${endpoint} over ` +
          `${entry.endpoint} — keeping the public registration. Set PROVIDER_PUBLIC_URL in .env ` +
          `to change it (the exchange routes to the endpoint on the registry topic, not to /info).`,
      );
    } else {
      log(profile.key, `endpoint changed (${entry.endpoint} → ${endpoint}) — re-registering on HCS`);
      entry.registered = undefined;
    }
  }

  if (!entry.staked) {
    try {
      entry.staked = await stakeToEscrow(id, key);
      log(profile.key, `staked ${STAKE_HBAR} ℏ → escrow: ${hashscanTx(entry.staked)}`);
    } catch (e) {
      log(profile.key, `WARN stake failed (${(e as Error).message.slice(0, 100)}) — continuing unstaked`);
    }
  } else {
    log(profile.key, `already staked (${entry.staked})`);
  }

  if (!entry.registered) {
    try {
      entry.registered = await publishToTopic("registry", { id, key }, {
        type: "registration",
        agentId,
        account: id,
        displayName: profile.displayName,
        model: profile.advertisedModel,
        price: profile.price,
        // HCS messages are immutable, so the price unit has to travel with the price —
        // otherwise an archived registration can't say what `price` was denominated in.
        asset: ASSET_LABEL,
        endpoint,
        stakeHbar: STAKE_HBAR, // the quality bond is always native HBAR, regardless of settlement asset
        stakeTx: entry.staked ?? null,
        hcs14: {
          uaid: agentId,
          profile: `data:application/json,{"name":"${profile.displayName}","model":"${profile.advertisedModel}"}`,
        },
      });
      entry.endpoint = endpoint;
      log(profile.key, `registered on HCS registry topic (${endpoint}): ${hashscanTx(entry.registered)}`);
    } catch (e) {
      log(profile.key, `WARN HCS registration failed (${(e as Error).message.slice(0, 100)}) — exchange will fall back to /info discovery`);
    }
  } else {
    log(profile.key, `already registered on HCS (${entry.registered})`);
  }

  cache[id] = entry;
  writeCache(cache);

  // Best-effort: surface the provider's HTS ReputationBond (ARBOND) balance —
  // its on-chain reputation, frozen/wiped by the verifier on fraud.
  if (bondTokenId()) {
    try {
      const bond = await bondBalance(id);
      log(profile.key, `ReputationBond: ${bond} ARBOND`);
    } catch {
      /* non-critical */
    }
  }

  return { wallet: id, agentId, key };
}
