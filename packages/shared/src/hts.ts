// HTS ReputationBond (ARBOND) — runtime enforcement helpers, no Solidity.
//
// The bond is a fungible HTS token (created once by `pnpm setup-hts`) whose
// per-provider balance IS that provider's on-chain reputation. Enforcement is
// additive to the proven native-HBAR escrow slash: on fraud the verifier
// destroys the fraudster's bond with a 2-of-2 multi-sig TokenWipe — the token's
// wipeKey is a KeyList [verifier, auditor], so the wipe needs both signatures.
//
// (TokenWipe is not in Hedera's Schedule Service whitelist — a scheduled wipe
// returns SCHEDULED_TRANSACTION_NOT_IN_WHITELIST — so the multi-sig is a direct
// two-signature transaction, not a scheduled one. See docs/HEDERAFEEDBACK.md.)
//
// Every function is real-mode only; callers guard with `if (!MOCK_MODE)` exactly
// like stakeToEscrow / slashOnChain. All return null on failure so a testnet
// hiccup degrades gracefully and never blocks the demo flow.

import fs from "node:fs";
import path from "node:path";
import { hederaAccount } from "./hedera.js";

// ARBOND grant per provider (also the wipe amount). Balance == reputation.
export const BOND_AMOUNT = parseInt(process.env.BOND_AMOUNT || "100", 10);

// Token id: env override first, then deployments.json (mirrors getTopicId).
export function bondTokenId(): string | null {
  if (process.env.HTS_BOND_TOKEN) return process.env.HTS_BOND_TOKEN;
  try {
    const d = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "deployments.json"), "utf8"));
    return d.hederaTestnet?.bondToken ?? null;
  } catch {
    return null;
  }
}

/* v8 ignore start -- Hedera SDK network I/O (HTS); real mode only */

// ARBOND balance of an account (consensus-node query, no mirror lag).
export async function bondBalance(accountId: string): Promise<number> {
  const token = bondTokenId();
  if (!token) return 0;
  const { Client, AccountBalanceQuery } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet();
  try {
    const b = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
    const amount = b.tokens?.get(token);
    return amount ? Number(amount.toString()) : 0;
  } catch {
    return 0;
  } finally {
    client.close();
  }
}

// Destroy a fraudster's bond with a 2-of-2 multi-sig TokenWipe. The token's
// wipeKey is a KeyList [verifier, auditor]; the verifier freezes + signs the
// transaction, the auditor co-signs, then it executes — reputation → 0 on-chain,
// requiring two independent signatures. Returns the wipe tx id (null on failure).
// Compliance control: freeze the fraudster's bond so it cannot move while the
// 2-of-2 wipe is assembled. Single-signer — the verifier alone holds the freezeKey,
// which is the point: containment is immediate, destruction needs a second party.
export async function freezeBond(accountId: string): Promise<string | null> {
  const token = bondTokenId();
  if (!token) return null;
  const verifier = hederaAccount("VERIFIER");
  const { Client, AccountId, PrivateKey, TokenId, TokenFreezeTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(verifier.id),
    PrivateKey.fromStringECDSA(verifier.key),
  );
  try {
    const tx = await new TokenFreezeTransaction()
      .setTokenId(TokenId.fromString(token))
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } catch (e) {
    console.warn(`[verifier] bond freeze failed: ${(e as Error).message.slice(0, 140)}`);
    return null;
  } finally {
    client.close();
  }
}

// Release a freeze. Required before a wipe: Hedera rejects TokenWipe against a
// frozen balance with ACCOUNT_FROZEN_FOR_TOKEN.
export async function unfreezeBond(accountId: string): Promise<string | null> {
  const token = bondTokenId();
  if (!token) return null;
  const verifier = hederaAccount("VERIFIER");
  const { Client, AccountId, PrivateKey, TokenId, TokenUnfreezeTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(verifier.id),
    PrivateKey.fromStringECDSA(verifier.key),
  );
  try {
    const tx = await new TokenUnfreezeTransaction()
      .setTokenId(TokenId.fromString(token))
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } catch {
    return null;
  } finally {
    client.close();
  }
}

export async function multiSigWipeBond(accountId: string, amount: number, retried = false): Promise<string | null> {
  const token = bondTokenId();
  if (!token) return null;
  const verifier = hederaAccount("VERIFIER");
  const auditor = hederaAccount("AUDITOR");
  const { Client, AccountId, PrivateKey, TokenId, TokenWipeTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(verifier.id),
    PrivateKey.fromStringECDSA(verifier.key),
  );
  try {
    const wipe = await new TokenWipeTransaction()
      .setTokenId(TokenId.fromString(token))
      .setAccountId(AccountId.fromString(accountId))
      .setAmount(amount)
      .freezeWith(client)
      .sign(PrivateKey.fromStringECDSA(verifier.key)); // signature 1 (verifier)
    const signed = await wipe.sign(PrivateKey.fromStringECDSA(auditor.key)); // signature 2 (auditor)
    const tx = await signed.execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } catch (e) {
    const msg = (e as Error).message;
    // A bond frozen by an earlier enforcement pass blocks its own destruction.
    // Lift the freeze and try once more — the verifier holds the freeze key.
    if (msg.includes("ACCOUNT_FROZEN_FOR_TOKEN") && !retried) {
      console.warn("[verifier] bond is frozen — unfreezing so the wipe can proceed");
      await unfreezeBond(accountId);
      return multiSigWipeBond(accountId, amount, true);
    }
    console.warn(`[verifier] multi-sig wipe failed: ${msg.slice(0, 140)}`);
    return null;
  } finally {
    client.close();
  }
}
/* v8 ignore stop */
