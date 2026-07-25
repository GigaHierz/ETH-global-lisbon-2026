// HTS ReputationBond (ARBOND) — runtime enforcement helpers, no Solidity.
//
// The bond is a fungible HTS token (created once by `pnpm setup-hts`) whose
// per-provider balance IS that provider's on-chain reputation. Enforcement is
// additive to the proven native-HBAR escrow slash: on fraud the verifier
//   1. FREEZES the fraudster's bond (compliance control, verifier holds freezeKey), then
//   2. schedules a WIPE that needs a second signer — the token's wipeKey is a
//      2-of-2 KeyList [verifier, auditor], so destroying reputation is multi-sig.
//      Verifier ScheduleCreate (sig 1) → auditor ScheduleSign (sig 2) → wipe executes.
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

/* v8 ignore start -- Hedera SDK network I/O (HTS + Schedule Service); real mode only */

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

// Compliance control: freeze the fraudster's bond (verifier holds freezeKey).
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
  } catch {
    return null;
  } finally {
    client.close();
  }
}

// Propose the wipe as a scheduled transaction. The token wipeKey is 2-of-2
// [verifier, auditor]; the verifier's signature (as operator of the
// ScheduleCreate) is signature 1. Returns the schedule id to be co-signed.
export async function scheduledWipeBond(
  accountId: string,
  amount: number,
): Promise<{ scheduleId: string | null }> {
  const token = bondTokenId();
  if (!token) return { scheduleId: null };
  const verifier = hederaAccount("VERIFIER");
  const { Client, AccountId, PrivateKey, TokenId, TokenWipeTransaction, ScheduleCreateTransaction } =
    await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(verifier.id),
    PrivateKey.fromStringECDSA(verifier.key),
  );
  try {
    const wipe = new TokenWipeTransaction()
      .setTokenId(TokenId.fromString(token))
      .setAccountId(AccountId.fromString(accountId))
      .setAmount(amount);
    const tx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(wipe)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return { scheduleId: receipt.scheduleId?.toString() ?? null };
  } catch {
    return { scheduleId: null };
  } finally {
    client.close();
  }
}

// Second signature (auditor) on the scheduled wipe → threshold met → wipe
// executes on-chain. In production this signer is independent of the verifier.
export async function signSchedule(scheduleId: string): Promise<string | null> {
  const auditor = hederaAccount("AUDITOR");
  const { Client, AccountId, PrivateKey, ScheduleId, ScheduleSignTransaction } =
    await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(auditor.id),
    PrivateKey.fromStringECDSA(auditor.key),
  );
  try {
    const tx = await new ScheduleSignTransaction()
      .setScheduleId(ScheduleId.fromString(scheduleId))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } catch {
    return null;
  } finally {
    client.close();
  }
}
/* v8 ignore stop */
