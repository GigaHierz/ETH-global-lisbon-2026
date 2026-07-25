// Provider identity + staking (no-Solidity path).
// Real mode, on boot (idempotent via .registry-cache.json):
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
  MOCK_MODE,
} from "@agentrouter/shared";
import type { ProviderProfile } from "./profiles.js";

const CACHE_FILE = path.join(process.cwd(), ".registry-cache.json");
const STAKE_HBAR = parseFloat(process.env.STAKE_HBAR || "50");

interface CacheEntry {
  staked?: string; // stake tx id
  registered?: string; // registration HCS tx id
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(c: Record<string, CacheEntry>) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
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

export async function ensureRegistered(
  profile: ProviderProfile,
  publicUrl: string = `http://localhost:${profile.port}`,
): Promise<{ wallet: string; agentId: string | null; key: string }> {
  if (MOCK_MODE) {
    const agentId = `mock-${profile.key}`;
    log(profile.key, `MOCK registry: agentId=${agentId}`);
    return { wallet: `0.0.mock-${profile.key}`, agentId, key: "" };
  }

  const { id, key } = hederaAccount(profile.hederaRole);
  const agentId = `uaid:aid:hedera:testnet:${id}`; // HCS-14-style universal agent id
  const cache = readCache();
  const entry: CacheEntry = cache[id] ?? {};

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
        priceHbar: profile.priceHbar,
        endpoint: publicUrl,
        stakeHbar: STAKE_HBAR,
        stakeTx: entry.staked ?? null,
        hcs14: {
          uaid: agentId,
          profile: `data:application/json,{"name":"${profile.displayName}","model":"${profile.advertisedModel}"}`,
        },
      });
      log(profile.key, `registered on HCS registry topic: ${hashscanTx(entry.registered)}`);
    } catch (e) {
      log(profile.key, `WARN HCS registration failed (${(e as Error).message.slice(0, 100)}) — exchange will fall back to /info discovery`);
    }
  } else {
    log(profile.key, `already registered on HCS (${entry.registered})`);
  }

  cache[id] = entry;
  writeCache(cache);
  return { wallet: id, agentId, key };
}
