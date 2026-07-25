// Creates + funds the 6 demo accounts on Hedera Testnet from the operator in .env.
// Idempotent: roles already present in .env are skipped. Safe to re-run after the
// Circle faucet trip to distribute USDC.
//
//   pnpm setup-hedera
//
// Verified against docs.hedera.com create-an-account and @x402/hedera@2.19.0 source:
// USDC (HTS) on testnet = 0.0.429274, 6 decimals; receivers must be associated.

import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  AccountCreateTransaction,
  AccountBalanceQuery,
  TokenAssociateTransaction,
  TransferTransaction,
  TokenId,
} from "@hiero-ledger/sdk";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(import.meta.dirname, "../.env");
const USDC = TokenId.fromString("0.0.429274");
const USDC_DECIMALS = 6;
// ESCROW is the verifier-held stake escrow (no-Solidity staking): providers
// transfer STAKE_HBAR here at registration; a slash moves it to the treasury
// (= operator). Its key lives in HEDERA_ESCROW_KEY, loaded by the verifier.
const ROLES = ["AGENT", "EXCHANGE", "PROVIDER1", "PROVIDER2", "PROVIDER3", "VERIFIER", "ESCROW"] as const;
const HBAR_PER_ACCOUNT = 100;
const USDC_PER_PAYER = 5; // agent + exchange only (USDC path is optional, behind SETTLEMENT_ASSET=usdc)
const PAYERS = new Set(["AGENT", "EXCHANGE"]);

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

  // ── 1. associate operator with USDC so the Circle faucet can deliver ──
  const opUsdc = opBalance.tokens?.get(USDC);
  if (opUsdc === undefined || opUsdc === null) {
    console.log("associating operator with USDC 0.0.429274…");
    await (await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(operatorId))
      .setTokenIds([USDC])
      .execute(client)).getReceipt(client);
    console.log("✓ operator associated — you can now hit https://faucet.circle.com (Hedera Testnet → 0.0.9695453)");
  }

  // ── 2. create + fund the role accounts ──
  const created: Record<string, { id: string; evm: string }> = {};
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

    // associate USDC (fee paid by operator, signed by the new account's key)
    await (await (await new TokenAssociateTransaction()
      .setAccountId(receipt.accountId!)
      .setTokenIds([USDC])
      .freezeWith(client)
      .sign(key)).execute(client)).getReceipt(client);

    created[role] = { id, evm };
    lines.push(
      `HEDERA_${role}_ID=${id}`,
      `HEDERA_${role}_KEY=0x${key.toStringRaw()}`,
      `HEDERA_${role}_EVM=${evm}`,
    );
    console.log(`✓ ${role}: ${id} (${evm}) — ${HBAR_PER_ACCOUNT} ℏ, USDC associated`);
    console.log(`  https://hashscan.io/testnet/account/${id}`);
  }

  // ── 3. distribute USDC to payers if the faucet already delivered ──
  const opUsdcNow = (await new AccountBalanceQuery().setAccountId(operatorId).execute(client)).tokens?.get(USDC);
  const usdcUnits = opUsdcNow ? BigInt(opUsdcNow.toString()) : 0n;
  const need = BigInt(USDC_PER_PAYER * 10 ** USDC_DECIMALS);
  const payerIds = [...PAYERS].map(r => created[r]?.id ?? env(`HEDERA_${r}_ID`)).filter(Boolean) as string[];
  if (usdcUnits >= need * BigInt(payerIds.length)) {
    const tx = new TransferTransaction();
    for (const pid of payerIds) {
      tx.addTokenTransfer(USDC, AccountId.fromString(operatorId), -Number(need))
        .addTokenTransfer(USDC, AccountId.fromString(pid), Number(need));
    }
    await (await tx.execute(client)).getReceipt(client);
    console.log(`✓ sent ${USDC_PER_PAYER} USDC to each payer: ${payerIds.join(", ")}`);
  } else {
    console.log(`! operator USDC balance ${usdcUnits} units — hit https://faucet.circle.com (Hedera Testnet → ${operatorId}), then re-run to distribute`);
  }

  if (lines.length) {
    appendFileSync(ENV_PATH, `\n# ── Hedera demo accounts (generated ${new Date().toISOString()}) ──\n${lines.join("\n")}\n`);
    console.log(`\n✓ appended ${lines.length} lines to .env`);
  }
  console.log("\ndone.");
  client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
