// Failure refunds (REFUND_ON_FAILURE, default true).
//
// Real mode note: the x402 middleware settles the agent's payment AFTER the
// handler responds successfully, so a provider failure normally CANCELS the
// verified payment — the agent is never charged and no refund is needed
// (strictly better than refund-after-charge). This module covers the cases
// where money did move and must come back: the mock ledger (charged up-front)
// and any settled-then-failed edge in real mode. Refund = a transfer of
// totalUnits back to the payer with memo refund:<quoteId>.
//
// The refund has to move the SAME asset the payment did. Refunding HBAR for a
// USDC payment would return the wrong token at the wrong scale, so this branches
// on SETTLEMENT_ASSET exactly like the payment path does.

import {
  MOCK_MODE,
  SETTLEMENT_ASSET,
  USDC_TOKEN_ID,
  fromBaseUnits,
  money,
  hederaAccount,
  log,
} from "@agentrouter/shared";
import { mockLedger } from "./state.js";

export const REFUND_ON_FAILURE = (process.env.REFUND_ON_FAILURE ?? "true") === "true";

export interface RefundResult {
  ok: boolean;
  refundRef?: string;
  error?: string;
}

export async function sendRefund(
  payerAccount: string,
  totalUnits: number,
  quoteId: string,
): Promise<RefundResult> {
  const amount = fromBaseUnits(totalUnits);
  if (MOCK_MODE) {
    // Simulated: credit the payer's ledger row back and mint a mock ref.
    mockLedger.set(payerAccount, (mockLedger.get(payerAccount) ?? 0) + amount);
    const refundRef = `mock-refund-${quoteId}`;
    log("exchange", `↩ REFUND (mock) ${money(amount)} → ${payerAccount} (${refundRef})`);
    return { ok: true, refundRef };
  }
  try {
    const { Client, AccountId, PrivateKey, Hbar, TokenId, TransferTransaction } = await import("@hiero-ledger/sdk");
    const exchange = hederaAccount("EXCHANGE");
    const client = Client.forTestnet().setOperator(
      AccountId.fromString(exchange.id),
      PrivateKey.fromStringECDSA(exchange.key),
    );
    try {
      const from = AccountId.fromString(exchange.id);
      const to = AccountId.fromString(payerAccount);
      const transfer = new TransferTransaction().setTransactionMemo(`refund:${quoteId}`);
      if (SETTLEMENT_ASSET === "hbar") {
        transfer
          .addHbarTransfer(from, Hbar.fromTinybars(-totalUnits))
          .addHbarTransfer(to, Hbar.fromTinybars(totalUnits));
      } else {
        const token = TokenId.fromString(USDC_TOKEN_ID);
        transfer
          .addTokenTransfer(token, from, -totalUnits)
          .addTokenTransfer(token, to, totalUnits);
      }
      const tx = await transfer.execute(client);
      await tx.getReceipt(client);
      const refundRef = tx.transactionId!.toString();
      log("exchange", `↩ REFUND ${money(amount)} → ${payerAccount} tx=${refundRef}`);
      log("exchange", `↩ https://hashscan.io/testnet/transaction/${refundRef}`);
      return { ok: true, refundRef };
    } finally {
      client.close();
    }
  } catch (e) {
    const error = (e as Error).message.slice(0, 160);
    log("exchange", `🚨🚨 REFUND FAILED for ${payerAccount} (${quoteId}): ${error} — agent is OWED ${money(amount)}`);
    return { ok: false, error };
  }
}
