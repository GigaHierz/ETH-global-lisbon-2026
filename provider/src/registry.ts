// ERC-8004 Identity Registry self-registration (idempotent).
// Real mode: register(agentURI) on the official Base Sepolia registry, cache the
// agentId locally so reboots don't re-register. Mock mode: fabricated agentId.

import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  IDENTITY_REGISTRY,
  identityRegistryAbi,
  publicClient,
  walletClient,
  log,
  MOCK_MODE,
} from "@agentrouter/shared";
import type { ProviderProfile } from "./profiles.js";

const CACHE_FILE = path.join(process.cwd(), ".registry-cache.json");

function readCache(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function ensureRegistered(
  profile: ProviderProfile,
  pk: `0x${string}`,
): Promise<{ wallet: `0x${string}`; agentId: string | null }> {
  const account = privateKeyToAccount(pk);
  const wallet = account.address;

  if (MOCK_MODE) {
    const agentId = `mock-${profile.key}`;
    log(profile.key, `MOCK registry: agentId=${agentId} wallet=${wallet}`);
    return { wallet, agentId };
  }

  const cache = readCache();
  if (cache[wallet]) {
    log(profile.key, `already registered: agentId=${cache[wallet]}`);
    return { wallet, agentId: cache[wallet] };
  }

  try {
    const agentURI = JSON.stringify({
      name: profile.displayName,
      model: profile.advertisedModel,
      priceUsd: profile.priceUsd,
      service: "agentrouter-provider",
    });
    const wc = walletClient(account);
    const pc = publicClient();
    const hash = await wc.writeContract({
      address: IDENTITY_REGISTRY,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [`data:application/json,${agentURI}`],
    });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    // Registered event: topic0, agentId is indexed topic1
    const ev = receipt.logs.find(
      (l) => l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase(),
    );
    const agentId = ev?.topics[1] ? BigInt(ev.topics[1]).toString() : null;
    if (agentId) {
      cache[wallet] = agentId;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
    log(profile.key, `registered in ERC-8004 IdentityRegistry: agentId=${agentId} tx=${hash}`);
    return { wallet, agentId };
  } catch (err) {
    log(profile.key, `WARN: on-chain registration failed (${(err as Error).message.slice(0, 120)}) — continuing unregistered`);
    return { wallet, agentId: null };
  }
}
