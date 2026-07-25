// The exchange's paying HTTP client. Real mode: x402 wrapped fetch signing
// HBAR transfers with the exchange's Hedera key (settlement fees sponsored by
// the facilitator feePayer). Mock mode: plain fetch + mock payment header.

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  HEDERA_NETWORK,
  hederaAccount,
  log,
} from "@agentrouter/shared";
import { mockLedger } from "./state.js";

export interface PaidResult {
  res: Response;
  paymentRef: string;
}

let realFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
let receiptReader: ((res: Response) => string) | null = null;

export async function initPayer() {
  if (MOCK_MODE) {
    log("exchange", "MOCK payer ready (in-memory ledger)");
    return;
  }
  const { x402Client, wrapFetchWithPayment, x402HTTPClient } = await import("@x402/fetch");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
  const { createClientHederaSigner } = await import("@x402/hedera");
  const { PrivateKey } = await import("@hiero-ledger/sdk");

  const { id, key } = hederaAccount("EXCHANGE");
  const signer = createClientHederaSigner(id, PrivateKey.fromStringECDSA(key), {
    network: HEDERA_NETWORK,
  });
  const client = new x402Client();
  client.register("hedera:*", new ExactHederaScheme(signer));
  const wrapped = wrapFetchWithPayment(fetch, client);
  realFetch = (url, init) => wrapped(url, init as never);
  const httpClient = new x402HTTPClient(client);
  receiptReader = (res) => {
    try {
      const receipt = httpClient.getPaymentSettleResponse((n: string) => res.headers.get(n));
      return (receipt as { transaction?: string })?.transaction ?? JSON.stringify(receipt).slice(0, 66);
    } catch {
      return "settled";
    }
  };
  log("exchange", `x402 payer ready: ${id} (HBAR on ${HEDERA_NETWORK})`);
}

export async function paidPost(
  url: string,
  body: unknown,
  priceHbar: number,
  providerWallet: string,
): Promise<PaidResult> {
  if (MOCK_MODE) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [MOCK_PAYMENT_HEADER]: String(priceHbar) },
      body: JSON.stringify(body),
    });
    const ref = `mock-pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    mockLedger.set(providerWallet, (mockLedger.get(providerWallet) ?? 0) + priceHbar);
    return { res, paymentRef: ref };
  }
  const res = await realFetch!(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, paymentRef: receiptReader!(res) };
}
