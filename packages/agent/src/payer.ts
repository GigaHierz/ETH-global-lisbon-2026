// The agent's paying HTTP client. Real mode: x402-wrapped fetch that signs the
// HBAR payment to the exchange with the AGENT's own Hedera key (settlement fee
// sponsored by the facilitator feePayer). Mock mode: plain fetch + mock header.
//
// This is the "both A1+A2" leg: the AGENT account itself signs the x402 payment,
// so its wallet visibly drains on Hashscan while the payment flows agent→exchange
// entirely over the x402 protocol.

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  HEDERA_NETWORK,
  hederaAccount,
  log,
} from "@agentrouter/shared";

export interface PaidResult {
  res: Response;
  paymentRef: string;
  /** What the mock leg actually paid (parsed from the 402 quote); real mode reads it from the response body. */
  paidHbar?: number;
}

let realFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
let receiptReader: ((res: Response) => string) | null = null;

export async function initAgentPayer() {
  if (MOCK_MODE) {
    log("agent", "MOCK payer ready");
    return;
  }
  const { x402Client, wrapFetchWithPayment, x402HTTPClient } = await import("@x402/fetch");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
  const { createClientHederaSigner } = await import("@x402/hedera");
  const { PrivateKey } = await import("@hiero-ledger/sdk");

  const { id, key } = hederaAccount("AGENT");
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
      return (receipt as { transaction?: string })?.transaction ?? "settled";
    } catch {
      return "settled";
    }
  };
  log("agent", `x402 payer ready: ${id} (HBAR on ${HEDERA_NETWORK})`);
}

// POST to the exchange, paying its x402 ask. In real mode the x402 client reads
// the 402 challenge and pays the exact amount automatically; askHbar is only used
// for the mock payment header.
export async function paidPost(url: string, body: unknown, askHbar: number): Promise<PaidResult> {
  if (MOCK_MODE) {
    // Mirror the real x402 client: fire unpaid, read the 402's dynamic quote
    // (provider price + exchange fee), then retry paying the exact total.
    const payload = { method: "POST" as const, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const unpaid = await fetch(url, payload);
    if (unpaid.status !== 402) {
      return { res: unpaid, paymentRef: `mock-agent-pay-${Date.now().toString(36)}` };
    }
    let totalHbar = askHbar; // fallback guess if the 402 is unparseable
    try {
      const challenge = (await unpaid.json()) as { accepts?: Array<{ price?: string }> };
      const m = challenge.accepts?.[0]?.price?.match(/([\d.]+)/);
      if (m) totalHbar = parseFloat(m[1]);
    } catch { /* keep fallback */ }
    const res = await fetch(url, {
      ...payload,
      headers: { ...payload.headers, [MOCK_PAYMENT_HEADER]: String(totalHbar) },
    });
    return { res, paymentRef: `mock-agent-pay-${Date.now().toString(36)}`, paidHbar: totalHbar };
  }
  const res = await realFetch!(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, paymentRef: receiptReader!(res) };
}
