// Tops role accounts back up to a target HBAR balance from the operator.
//
//   pnpm fund-accounts                 # top every role up to 50 ℏ
//   pnpm fund-accounts --target 100    # ...to 100 ℏ
//   pnpm fund-accounts --roles PROVIDER1,PROVIDER3
//
// Why this exists: providers stake STAKE_HBAR (50 ℏ) into escrow on first boot and
// remember it in .registry-cache.json. That cache is a local file, so a fresh
// container has no memory of it and stakes again — every redeploy costs another
// 50 ℏ. A provider that runs dry stops being able to pay HCS fees, and its
// registration quietly starts failing while payments still work (settlement fees
// are facilitator-sponsored, so receiving USDC needs no HBAR at all).
//
// Transfers only the shortfall, so this is safe to re-run.

import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  AccountBalanceQuery,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(import.meta.dirname, "../.env");
const ALL_ROLES = ["AGENT", "EXCHANGE", "PROVIDER1", "PROVIDER2", "PROVIDER3", "PROVIDER4", "PROVIDER", "VERIFIER", "AUDITOR"];

function env(name: string): string | undefined {
  const m = readFileSync(ENV_PATH, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const target = parseFloat(arg("--target") ?? "50");
  const roles = (arg("--roles")?.split(",").map((r) => r.trim().toUpperCase()) ?? ALL_ROLES).filter(Boolean);

  const operatorId = env("HEDERA_OPERATOR_ID");
  const operatorKey = env("HEDERA_OPERATOR_KEY");
  if (!operatorId || !operatorKey) throw new Error("HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY missing from .env");

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringECDSA(operatorKey),
  );

  const opStart = (await new AccountBalanceQuery().setAccountId(operatorId).execute(client)).hbars
    .toBigNumber()
    .toNumber();
  console.log(`operator ${operatorId}: ${opStart.toFixed(2)} ℏ — topping ${roles.length} roles up to ${target} ℏ\n`);

  let spent = 0;
  for (const role of roles) {
    const id = env(`HEDERA_${role}_ID`);
    if (!id) {
      console.log(`  = ${role} not in .env — skipping`);
      continue;
    }
    const held = (await new AccountBalanceQuery().setAccountId(id).execute(client)).hbars.toBigNumber().toNumber();
    const shortfall = target - held;
    if (shortfall <= 0) {
      console.log(`  = ${role} (${id}) already at ${held.toFixed(2)} ℏ`);
      continue;
    }
    if (spent + shortfall > opStart - 50) {
      console.warn(`  ⚠ stopping: operator would drop below a 50 ℏ reserve. Refill at https://portal.hedera.com`);
      break;
    }
    // Work in integer tinybars: 60 - 49.95 is 10.050000000000004 in float, and Hbar
    // rejects sub-tinybar precision outright.
    const tinybars = Math.round(shortfall * 100_000_000);
    await (
      await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(operatorId), Hbar.fromTinybars(-tinybars))
        .addHbarTransfer(AccountId.fromString(id), Hbar.fromTinybars(tinybars))
        .execute(client)
    ).getReceipt(client);
    spent += shortfall;
    console.log(`  ✓ ${role} (${id}): ${held.toFixed(2)} → ${target.toFixed(2)} ℏ (+${shortfall.toFixed(2)})`);
  }

  const opEnd = (await new AccountBalanceQuery().setAccountId(operatorId).execute(client)).hbars
    .toBigNumber()
    .toNumber();
  console.log(`\ndone. operator ${opStart.toFixed(2)} → ${opEnd.toFixed(2)} ℏ`);
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
