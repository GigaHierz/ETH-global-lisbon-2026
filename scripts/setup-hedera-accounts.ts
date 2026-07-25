// Creates + funds the 8 demo accounts on Hedera Testnet from the operator in .env.
// Idempotent: roles already present in .env are skipped. Safe to re-run.
//
//   pnpm setup-hedera
//
// Verified against docs.hedera.com create-an-account and @x402/hedera@2.19.0 source.

import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  AccountCreateTransaction,
  AccountBalanceQuery,
} from "@hiero-ledger/sdk";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(import.meta.dirname, "../.env");
// ESCROW is the verifier-held stake escrow (no-Solidity staking): providers
// transfer STAKE_HBAR here at registration; a slash moves it to the treasury
// (= operator). Its key lives in HEDERA_ESCROW_KEY, loaded by the verifier.
const ROLES = ["AGENT", "EXCHANGE", "PROVIDER1", "PROVIDER2", "PROVIDER3", "PROVIDER4", "VERIFIER", "ESCROW"] as const;
const HBAR_PER_ACCOUNT = 100;

function env(name: string): string | undefined {
  const m = readFileSync(ENV_PATH, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

async function main() {
  const operatorId = env("HEDERA_OPERATOR_ID");
  const operatorKey = env("HEDERA_OPERATOR_KEY");
  if (!operatorId || !operatorKey) throw new Error("HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY missing from .env");

  const opKey = PrivateKey.fromStringECDSA(operatorKey);
  const client = Client.forTestnet().setOperator(AccountId.fromString(operatorId), opKey);

  const opBalance = await new AccountBalanceQuery().setAccountId(operatorId).execute(client);
  console.log(`operator ${operatorId}: ${opBalance.hbars.toString()}`);
  if (opBalance.hbars.toBigNumber().lt(650)) {
    console.warn("⚠ operator below 650 ℏ — refill at https://portal.hedera.com before proceeding");
  }

  // ── create + fund the role accounts ──
  const lines: string[] = [];
  for (const role of ROLES) {
    if (env(`HEDERA_${role}_ID`)) {
      console.log(`= ${role} already in .env (${env(`HEDERA_${role}_ID`)}) — skipping`);
      continue;
    }
    const key = PrivateKey.generateECDSA();
    const receipt = await (await new AccountCreateTransaction()
      .setECDSAKeyWithAlias(key.publicKey)
      .setInitialBalance(new Hbar(HBAR_PER_ACCOUNT))
      .execute(client)).getReceipt(client);
    const id = receipt.accountId!.toString();
    const evm = `0x${key.publicKey.toEvmAddress()}`;

    lines.push(
      `HEDERA_${role}_ID=${id}`,
      `HEDERA_${role}_KEY=0x${key.toStringRaw()}`,
      `HEDERA_${role}_EVM=${evm}`,
    );
    console.log(`✓ ${role}: ${id} (${evm}) — ${HBAR_PER_ACCOUNT} ℏ`);
    console.log(`  https://hashscan.io/testnet/account/${id}`);
  }

  if (lines.length) {
    appendFileSync(ENV_PATH, `\n# ── Hedera demo accounts (generated ${new Date().toISOString()}) ──\n${lines.join("\n")}\n`);
    console.log(`\n✓ appended ${lines.length} lines to .env`);
  }
  console.log("\ndone.");
  client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
