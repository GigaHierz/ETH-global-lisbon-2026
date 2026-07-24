// The exchange's paying HTTP client. Real mode: x402 wrapped fetch signing with
// EXCHANGE_PK. Mock mode: plain fetch + mock payment header, ledger updated here.

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  log,
  requireEnv,
} from "@agentrouter/shared";
import { privateKeyToAccount } from "viem/accounts";
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
  const { ExactEvmScheme } = await import("@x402/evm/exact/client");
  const account = privateKeyToAccount(requireEnv("EXCHANGE_PK") as `0x${string}`);
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account));
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
  log("exchange", `x402 payer ready: ${account.address}`);
}

export async function paidPost(
  url: string,
  body: unknown,
  priceUsd: number,
  providerWallet: string,
): Promise<PaidResult> {
  if (MOCK_MODE) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [MOCK_PAYMENT_HEADER]: String(priceUsd) },
      body: JSON.stringify(body),
    });
    const ref = `mock-pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    mockLedger.set(providerWallet, (mockLedger.get(providerWallet) ?? 0) + priceUsd);
    return { res, paymentRef: ref };
  }
  const res = await realFetch!(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, paymentRef: receiptReader!(res) };
}
