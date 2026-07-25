// Prints the demo wallets' HBAR balances (consensus-node query, no mirror lag).
// Usage: pnpm tsx --env-file=.env scripts/balances.mts
import { hbarBalance } from "@agentrouter/shared";
const roles = ["AGENT", "EXCHANGE", "PROVIDER1"] as const;
const out: Record<string, number> = {};
for (const r of roles) {
  const id = process.env[`HEDERA_${r}_ID`];
  if (id) out[`${r.toLowerCase()} (${id})`] = await hbarBalance(id);
}
console.log(JSON.stringify(out, null, 1));
