// Creates the HTS ReputationBond token (ARBOND) as the operator and grants each
// provider its starting bond, then records the token id in deployments.json.
// Idempotent: an existing bondToken is kept and providers are topped up to
// BOND_AMOUNT rather than re-granted. Run: pnpm setup-hts
//
// No Solidity — pure Hedera Token Service via the SDK. Key layout (see hts.ts):
//   treasury/admin/supply/pause/feeSchedule = operator (mints + grants reputation)
//   freezeKey = verifier (immediate compliance freeze on fraud)
//   wipeKey   = 2-of-2 KeyList [verifier, auditor] (direct multi-sig wipe)
//   custom fee = 2% fractional → operator/treasury (the marketplace-fee rail)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = path.join(ROOT, "deployments.json");
const BOND_AMOUNT = parseInt(process.env.BOND_AMOUNT || "100", 10);
const GRANT_ROLES = ["PROVIDER1", "PROVIDER2", "PROVIDER3", "PROVIDER4", "PROVIDER"] as const;

function env(name: string): string | undefined {
  const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

async function main() {
  const operatorId = env("HEDERA_OPERATOR_ID");
  const operatorKey = env("HEDERA_OPERATOR_KEY");
  const verifierKey = env("HEDERA_VERIFIER_KEY");
  const auditorKey = env("HEDERA_AUDITOR_KEY");
  if (!operatorId || !operatorKey) throw new Error("HEDERA_OPERATOR_ID/KEY missing from .env");
  if (!verifierKey || !auditorKey) throw new Error("HEDERA_VERIFIER_KEY / HEDERA_AUDITOR_KEY missing — run pnpm setup-hedera");

  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"));
  deployments.hederaTestnet ??= {};

  const {
    Client, AccountId, PrivateKey, KeyList, TokenType, TokenSupplyType,
    TokenCreateTransaction, TokenAssociateTransaction, TransferTransaction,
    AccountBalanceQuery, TokenId, CustomFractionalFee,
  } = await import("@hiero-ledger/sdk");

  const opKey = PrivateKey.fromStringECDSA(operatorKey);
  const verifierPub = PrivateKey.fromStringECDSA(verifierKey).publicKey;
  const auditorPub = PrivateKey.fromStringECDSA(auditorKey).publicKey;
  const client = Client.forTestnet().setOperator(AccountId.fromString(operatorId), opKey);

  // wipeKey = 2-of-2 [verifier, auditor] → destroying reputation is multi-sig.
  const wipeKey = new KeyList([verifierPub, auditorPub], 2);

  // 2% fractional marketplace fee → treasury (operator). Treasury is exempt, so
  // grants are fee-free; the schedule exists on peer-to-peer bond transfers.
  const marketplaceFee = new CustomFractionalFee()
    .setNumerator(2)
    .setDenominator(100)
    .setFeeCollectorAccountId(AccountId.fromString(operatorId));

  // Create the token only once; the grant pass below still runs either way, so a
  // provider whose bond was wiped (or one added later) can be topped back up.
  let tokenId: string = deployments.hederaTestnet.bondToken ?? "";
  if (tokenId) {
    console.log(`= bondToken: ${tokenId} (exists) — checking provider bonds`);
  } else {
  console.log("creating ARBOND ReputationBond token…");
  const createReceipt = await (
    await new TokenCreateTransaction()
      .setTokenName("AgentRouter ReputationBond")
      .setTokenSymbol("ARBOND")
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(0)
      .setInitialSupply(BOND_AMOUNT * 100)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(AccountId.fromString(operatorId))
      .setAdminKey(opKey.publicKey)
      .setSupplyKey(opKey.publicKey)
      .setPauseKey(opKey.publicKey)
      .setFeeScheduleKey(opKey.publicKey)
      .setFreezeKey(verifierPub) // verifier freezes on fraud (compliance control)
      .setWipeKey(wipeKey) // 2-of-2 multi-sig wipe (TokenWipe is not schedulable)
      .setCustomFees([marketplaceFee])
      .setTokenMemo("agentrouter:reputation-bond")
      .execute(client)
  ).getReceipt(client);
  tokenId = createReceipt.tokenId!.toString();
  console.log(`✓ ARBOND: ${tokenId}  https://hashscan.io/testnet/token/${tokenId}`);
  }

  // Associate + top each provider up to BOND_AMOUNT. Transferring the shortfall
  // rather than a flat grant keeps this safe to re-run: a provider whose bond the
  // verifier wiped returns to full, and one already at full is left alone instead
  // of drifting to 2x and diluting what a wipe means.
  const token = TokenId.fromString(tokenId);
  for (const role of GRANT_ROLES) {
    const id = env(`HEDERA_${role}_ID`);
    const key = env(`HEDERA_${role}_KEY`);
    if (!id || !key) continue;
    const providerKey = PrivateKey.fromStringECDSA(key);
    try {
      const assoc = await (
        await new TokenAssociateTransaction()
          .setAccountId(AccountId.fromString(id))
          .setTokenIds([TokenId.fromString(tokenId)])
          .freezeWith(client)
          .sign(providerKey)
      ).execute(client);
      await assoc.getReceipt(client);
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.includes("TOKEN_ALREADY_ASSOCIATED")) {
        console.warn(`  ⚠ ${role} associate failed: ${msg.slice(0, 80)} — skipping grant`);
        continue;
      }
    }
    const held = Number(
      (await new AccountBalanceQuery().setAccountId(id).execute(client)).tokens?.get(token)?.toString() ?? 0,
    );
    const shortfall = BOND_AMOUNT - held;
    if (shortfall <= 0) {
      console.log(`  = ${role} already holds ${held} ARBOND`);
      continue;
    }
    await (
      await new TransferTransaction()
        .addTokenTransfer(token, AccountId.fromString(operatorId), -shortfall)
        .addTokenTransfer(token, AccountId.fromString(id), shortfall)
        .execute(client)
    ).getReceipt(client);
    console.log(`  ✓ ${role} (${id}): ${held} → ${BOND_AMOUNT} ARBOND (+${shortfall})`);
  }

  deployments.hederaTestnet.bondToken = tokenId;
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(deployments, null, 2) + "\n");
  console.log("\nrecorded bondToken in deployments.json");
  client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
