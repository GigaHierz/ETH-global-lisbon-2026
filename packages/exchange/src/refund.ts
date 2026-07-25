// Failure refunds (REFUND_ON_FAILURE, default true).
//
// Real mode note: the x402 middleware settles the agent's payment AFTER the
// handler responds successfully, so a provider failure normally CANCELS the
// verified payment — the agent is never charged and no refund is needed
// (strictly better than refund-after-charge). This module covers the cases
// where money did move and must come back: the mock ledger (charged up-front)
// and any settled-then-failed edge in real mode. Refund = CryptoTransfer of
// totalTinybar back to the payer with memo refund:<quoteId>.

import {
  MOCK_MODE,
  hbarOf,
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
  totalTinybar: number,
  quoteId: string,
): Promise<RefundResult> {
  if (MOCK_MODE) {
    // Simulated: credit the payer's ledger row back and mint a mock ref.
    mockLedger.set(payerAccount, (mockLedger.get(payerAccount) ?? 0) + hbarOf(totalTinybar));
    const refundRef = `mock-refund-${quoteId}`;
    log("exchange", `↩ REFUND (mock) ${hbarOf(totalTinybar)} ℏ → ${payerAccount} (${refundRef})`);
    return { ok: true, refundRef };
  }
  try {
    const { Client, AccountId, PrivateKey, Hbar, TransferTransaction } = await import("@hiero-ledger/sdk");
    const exchange = hederaAccount("EXCHANGE");
    const client = Client.forTestnet().setOperator(
      AccountId.fromString(exchange.id),
      PrivateKey.fromStringECDSA(exchange.key),
    );
    try {
      const tx = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(exchange.id), Hbar.fromTinybars(-totalTinybar))
        .addHbarTransfer(AccountId.fromString(payerAccount), Hbar.fromTinybars(totalTinybar))
        .setTransactionMemo(`refund:${quoteId}`)
        .execute(client);
      await tx.getReceipt(client);
      const refundRef = tx.transactionId!.toString();
      log("exchange", `↩ REFUND ${hbarOf(totalTinybar)} ℏ → ${payerAccount} tx=${refundRef}`);
      log("exchange", `↩ https://hashscan.io/testnet/transaction/${refundRef}`);
      return { ok: true, refundRef };
    } finally {
      client.close();
    }
  } catch (e) {
    const error = (e as Error).message.slice(0, 160);
    log("exchange", `🚨🚨 REFUND FAILED for ${payerAccount} (${quoteId}): ${error} — agent is OWED ${hbarOf(totalTinybar)} ℏ`);
    return { ok: false, error };
  }
}
