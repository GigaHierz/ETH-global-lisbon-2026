// Turns the exchange's response into the reasoning loop's BuyResult. The pure
// parser (parseBuyResult) is unit-tested; makeBuy wires it to the x402 payer so
// the loop can `buy(question)` without knowing about HTTP or Hedera.

import { paidPost } from "./payer.js";
import { hashscanTx } from "@agentrouter/shared";
import type { BuyResult } from "./loop.js";

interface ExchangeCompletion {
  choices?: { message?: { content?: string } }[];
  agentrouter?: {
    provider?: string;
    pricePaidHbar?: number; // legacy flat-ask field
    priceHbar?: number; // provider's listed price
    feeHbar?: number; // exchange taker fee
    totalHbar?: number; // what the agent paid (budget charges this)
  };
}

/** Parse the exchange completion + the agent's own settle tx into a BuyResult. */
export function parseBuyResult(json: ExchangeCompletion, paymentRef: string): BuyResult {
  const answer = json.choices?.[0]?.message?.content;
  const ar = json.agentrouter;
  const costHbar = ar?.totalHbar ?? ar?.pricePaidHbar; // total = price + fee; legacy fallback
  if (typeof answer !== "string" || answer.length === 0) {
    throw new Error("exchange response missing completion content");
  }
  if (typeof costHbar !== "number") {
    throw new Error("exchange response missing agentrouter.totalHbar");
  }
  return {
    answer,
    costHbar,
    priceHbar: ar?.priceHbar,
    feeHbar: ar?.feeHbar,
    provider: ar?.provider ?? "unknown",
    paymentRef,
  };
}

export interface BoughtWithLink extends BuyResult {
  hashscan: string;
}

/* v8 ignore start -- x402/HTTP network wiring around the unit-tested parseBuyResult */
/** Build the loop's `buy` function: POST a single question to the exchange, paying its x402 ask. */
export function makeBuy(exchangeUrl: string, askHbar: number, model: string) {
  return async (question: string): Promise<BoughtWithLink> => {
    const { res, paymentRef } = await paidPost(
      `${exchangeUrl}/v1/chat/completions`,
      { model, messages: [{ role: "user", content: question }], temperature: 0 },
      askHbar,
    );
    if (!res.ok) {
      throw new Error(`exchange ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
    const json = (await res.json()) as ExchangeCompletion;
    const result = parseBuyResult(json, paymentRef);
    return { ...result, hashscan: hashscanTx(paymentRef) };
  };
}
/* v8 ignore stop */
