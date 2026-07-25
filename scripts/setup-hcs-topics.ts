// Creates the three HCS audit topics (registry / trades / verdicts) as the
// operator and records them in deployments.json. Idempotent: existing ids are
// kept. Run: pnpm setup-hcs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = path.join(ROOT, "deployments.json");

function env(name: string): string | undefined {
  const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

async function main() {
  const operatorId = env("HEDERA_OPERATOR_ID");
  const operatorKey = env("HEDERA_OPERATOR_KEY");
  if (!operatorId || !operatorKey) throw new Error("HEDERA_OPERATOR_ID/KEY missing from .env");

  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"));
  deployments.hederaTestnet ??= {};
  deployments.hederaTestnet.topics ??= {};
  const topics: Record<string, string> = deployments.hederaTestnet.topics;

  const { Client, AccountId, PrivateKey, TopicCreateTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringECDSA(operatorKey),
  );

  for (const name of ["registry", "trades", "verdicts"]) {
    if (topics[name]) {
      console.log(`= ${name}: ${topics[name]} (exists)`);
      continue;
    }
    const receipt = await (
      await new TopicCreateTransaction().setTopicMemo(`agentrouter:${name}`).execute(client)
    ).getReceipt(client);
    topics[name] = receipt.topicId!.toString();
    console.log(`✓ ${name}: ${topics[name]}  https://hashscan.io/testnet/topic/${topics[name]}`);
  }

  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(deployments, null, 2) + "\n");
  console.log("\nrecorded in deployments.json");
  client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
