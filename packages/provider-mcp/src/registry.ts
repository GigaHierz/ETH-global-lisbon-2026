// HCS-14 registration, matching packages/provider/src/registry.ts ensureRegistered()
// byte-for-byte in payload shape so the exchange discovers an MCP-provisioned
// provider identically to a self-booted one. Idempotency via .registry-cache.json
// keyed by account id (same file/shape the provider service uses).

import { publishToTopic, ASSET_LABEL } from "@agentrouter/shared";
import { readCache, writeCache } from "./envStore.js";

export interface CacheEntry {
  staked?: string;
  registered?: string;
  endpoint?: string;
}

export function getCacheEntry(id: string): CacheEntry {
  return (readCache()[id] as CacheEntry) ?? {};
}

export function setStaked(id: string, stakeTx: string): void {
  const c = readCache();
  c[id] = { ...(c[id] ?? {}), staked: stakeTx };
  writeCache(c);
}

export function setRegistered(id: string, registrationTx: string, endpoint: string): void {
  const c = readCache();
  c[id] = { ...(c[id] ?? {}), registered: registrationTx, endpoint };
  writeCache(c);
}

export interface RegistrationInput {
  id: string;
  key: string;
  displayName: string;
  model: string;
  price: number;
  endpoint: string;
  stakeHbar: number;
  stakeTx: string | null;
}

export function uaidFor(accountId: string): string {
  return `uaid:aid:hedera:testnet:${accountId}`;
}

/** Publish the registration JSON to the HCS registry topic. Returns the tx id.
 *  Payload mirrors ensureRegistered() exactly (publishToTopic adds `ts`). */
export async function registerOnHcs(input: RegistrationInput): Promise<string> {
  const agentId = uaidFor(input.id);
  return publishToTopic(
    "registry",
    { id: input.id, key: input.key },
    {
      type: "registration",
      agentId,
      account: input.id,
      displayName: input.displayName,
      model: input.model,
      price: input.price,
      // HCS messages are immutable, so the price unit travels with the price.
      asset: ASSET_LABEL,
      endpoint: input.endpoint,
      stakeHbar: input.stakeHbar, // the bond is native HBAR regardless of settlement asset
      stakeTx: input.stakeTx,
      hcs14: {
        uaid: agentId,
        profile: `data:application/json,{"name":"${input.displayName}","model":"${input.model}"}`,
      },
    },
  );
}
