// Provider identity. Real mode: the provider IS its Hedera account; on-chain
// registration moves to the HCS registry topic (playbook step 3) — until that
// lands we return the account id and a derived agent id. Mock mode: fabricated
// identity, no network.

import { hederaAccount, log, MOCK_MODE } from "@agentrouter/shared";
import type { ProviderProfile } from "./profiles.js";

export async function ensureRegistered(
  profile: ProviderProfile,
): Promise<{ wallet: string; agentId: string | null; key: string }> {
  if (MOCK_MODE) {
    const agentId = `mock-${profile.key}`;
    log(profile.key, `MOCK registry: agentId=${agentId}`);
    return { wallet: `0.0.mock-${profile.key}`, agentId, key: "" };
  }
  const { id, key } = hederaAccount(profile.hederaRole);
  // TODO(step 3): publish HCS-14-style registration JSON to the registry topic
  // (universal agent id + erc8004_compat field) and stake STAKE_HBAR to escrow.
  const agentId = `hedera:testnet/${id}`;
  log(profile.key, `identity: ${id} (HCS registration lands in step 3)`);
  return { wallet: id, agentId, key };
}
