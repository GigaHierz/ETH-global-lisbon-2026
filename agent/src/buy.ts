// Turns the exchange's response into the reasoning loop's BuyResult. The pure
// parser (parseBuyResult) is unit-tested; makeBuy wires it to the x402 payer so
// the loop can `buy(question)` without knowing about HTTP or Hedera.

import { paidPost } from "./payer.js";
import { hashscanTx } from "@agentrouter/shared";
import type { BuyResult } from "./loop.js";

interface ExchangeCompletion {
  choices?: { message?: { content?: string } }[];
  agentrouter?: { provider?: string; pricePaidHbar?: number };
}

/** Parse the exchange completion + the agent's own settle tx into a BuyResult. */
export function parseBuyResult(json: ExchangeCompletion, paymentRef: string): BuyResult {
  const answer = json.choices?.[0]?.message?.content;
  const costHbar = json.agentrouter?.pricePaidHbar;
  if (typeof answer !== "string" || answer.length === 0) {
    throw new Error("exchange response missing completion content");
  }
  if (typeof costHbar !== "number") {
    throw new Error("exchange response missing agentrouter.pricePaidHbar");
  }
  return { answer, costHbar, provider: json.agentrouter?.provider ?? "unknown", paymentRef };
}

export interface BoughtWithLink extends BuyResult {
  hashscan: string;
}

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
