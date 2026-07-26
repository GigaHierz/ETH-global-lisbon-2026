// Creates + funds the demo accounts on Hedera Testnet from the operator in .env,
// then associates every account with USDC and tops up the paying roles.
// Idempotent throughout: safe (and expected) to re-run.
//
//   pnpm setup-hedera          # 1. create/fund/associate
//   → https://faucet.circle.com  (Hedera Testnet → operator id)
//   pnpm setup-hedera          # 2. re-run to distribute USDC now the faucet landed
//
// Verified against docs.hedera.com create-an-account and @x402/hedera@2.19.0 source:
// settlement runs on HTS USDC, and the scheme's own pre-flight rejects a payment when
// the payer is short (`insufficient_balance`) or the *receiver* isn't associated
// (`pay_to_not_associated`) — so association is required for payers and receivers alike.

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
import { USDC_TOKEN_ID, USDC_DECIMALS } from "@agentrouter/shared";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(import.meta.dirname, "../.env");
// ESCROW is the verifier-held stake escrow (no-Solidity staking): providers
// transfer STAKE_HBAR here at registration; a slash moves it to the treasury
// (= operator). Its key lives in HEDERA_ESCROW_KEY, loaded by the verifier.
// AUDITOR is the second signer on the HTS ReputationBond wipe: the token's
// wipeKey is a 2-of-2 [verifier, auditor], so destroying a bond is multi-sig.
const ROLES = ["AGENT", "EXCHANGE", "PROVIDER1", "PROVIDER2", "PROVIDER3", "PROVIDER4", "PROVIDER", "VERIFIER", "ESCROW", "AUDITOR"] as const;
const HBAR_PER_ACCOUNT = 100;

const USDC = TokenId.fromString(USDC_TOKEN_ID);

// Roles that *spend* USDC and therefore need a balance, not just an association:
//   AGENT    → pays the exchange's ask
//   EXCHANGE → pays the routed provider
//   VERIFIER → pays providers directly for its two audit replays. Easy to miss: it
//              looks like a passive observer, but an unfunded verifier means every
//              replay 402s, the audit returns "inconclusive", and no slash ever fires.
// Providers only ever receive, so association alone is enough for them.
const PAYERS = new Set<string>(["AGENT", "EXCHANGE", "VERIFIER"]);
const USDC_PER_PAYER = 6; // 3 payers = 18 USDC, inside the Circle faucet's ~20/2h cap

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

  // ── 1. associate the operator so the Circle faucet can deliver ──
  await associate("operator", operatorId, opKey, opBalance);

  // ── 2. create + fund the role accounts ──
  const lines: string[] = [];
  const accounts = new Map<string, { id: string; key: PrivateKey }>();
  for (const role of ROLES) {
    const existing = env(`HEDERA_${role}_ID`);
    if (existing) {
      const rawKey = env(`HEDERA_${role}_KEY`);
      if (rawKey) accounts.set(role, { id: existing, key: PrivateKey.fromStringECDSA(rawKey) });
      else console.warn(`! ${role} has an ID but no HEDERA_${role}_KEY — cannot associate it`);
      console.log(`= ${role} already in .env (${existing})`);
      continue;
    }
    const key = PrivateKey.generateECDSA();
    const receipt = await (await new AccountCreateTransaction()
      .setECDSAKeyWithAlias(key.publicKey)
      .setInitialBalance(new Hbar(HBAR_PER_ACCOUNT))
      .execute(client)).getReceipt(client);
    const id = receipt.accountId!.toString();
    const evm = `0x${key.publicKey.toEvmAddress()}`;

    accounts.set(role, { id, key });
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

  // ── 3. associate every role with USDC ──
  // Deliberately a separate pass over *all* roles rather than a step inside account
  // creation: accounts that already existed in .env would otherwise never be associated,
  // and an unassociated provider silently fails settlement at pay time.
  console.log(`\nassociating ${accounts.size} accounts with USDC ${USDC_TOKEN_ID}…`);
  for (const [role, { id, key }] of accounts) await associate(role, id, key);

  // ── 4. distribute USDC to the paying roles ──
  const payerIds = [...accounts].filter(([role]) => PAYERS.has(role)).map(([role, a]) => [role, a.id] as const);
  const need = BigInt(Math.round(USDC_PER_PAYER * 10 ** USDC_DECIMALS));
  const held = await usdcUnits(operatorId);
  const required = need * BigInt(payerIds.length);
  if (held >= required) {
    const tx = new TransferTransaction();
    for (const [, id] of payerIds) {
      tx.addTokenTransfer(USDC, AccountId.fromString(operatorId), -Number(need))
        .addTokenTransfer(USDC, AccountId.fromString(id), Number(need));
    }
    await (await tx.execute(client)).getReceipt(client);
    console.log(`✓ sent ${USDC_PER_PAYER} USDC to each payer: ${payerIds.map(([r]) => r).join(", ")}`);
  } else {
    console.log(
      `\n! operator holds ${fmtUsdc(held)} USDC, needs ${fmtUsdc(required)} to fund ` +
      `${payerIds.length} payers (${payerIds.map(([r]) => r).join(", ")}).\n` +
      `  → get testnet USDC at https://faucet.circle.com (Hedera Testnet → ${operatorId}),\n` +
      `    then re-run \`pnpm setup-hedera\` to distribute. Everything else above is already done.`,
    );
  }

  console.log("\ndone.");
  client.close();

  // Associates `id` with USDC unless it already is. Signed by the account's own key,
  // fee paid by the operator. Pass a known balance to save a query.
  async function associate(
    label: string,
    id: string,
    key: PrivateKey,
    balance?: Awaited<ReturnType<AccountBalanceQuery["execute"]>>,
  ) {
    const bal = balance ?? (await new AccountBalanceQuery().setAccountId(id).execute(client));
    if (bal.tokens?.get(USDC) != null) {
      console.log(`  = ${label} already associated`);
      return;
    }
    await (await (await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(id))
      .setTokenIds([USDC])
      .freezeWith(client)
      .sign(key)).execute(client)).getReceipt(client);
    console.log(`  ✓ ${label} associated with USDC`);
  }

  async function usdcUnits(id: string): Promise<bigint> {
    const bal = await new AccountBalanceQuery().setAccountId(id).execute(client);
    const t = bal.tokens?.get(USDC);
    return t ? BigInt(t.toString()) : 0n;
  }
}

function fmtUsdc(units: bigint): string {
  return (Number(units) / 10 ** USDC_DECIMALS).toFixed(2);
}

main().catch(e => { console.error(e); process.exit(1); });
