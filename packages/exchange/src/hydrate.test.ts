import { describe, it, expect } from "vitest";
import type { TopicMessage } from "@agentrouter/shared";
import { tradeToEntry, consensusToMs } from "./hydrate.js";

function msg(payload: Record<string, unknown> | null, sequence = 1, consensusTs = "1785033732.343117104"): TopicMessage {
  return { consensusTs, sequence, payload };
}

describe("consensusToMs", () => {
  it("converts a seconds.nanos consensus timestamp to epoch ms", () => {
    expect(consensusToMs("1785033732.343117104")).toBe(1785033732343);
  });

  it("returns 0 for anything unparseable rather than NaN", () => {
    // NaN would flow into the feed's ts and sort the row to an arbitrary position.
    expect(consensusToMs("not-a-timestamp")).toBe(0);
    expect(consensusToMs("")).toBe(0);
  });
});

describe("tradeToEntry", () => {
  const trade = {
    type: "trade",
    model: "llama-3.1-8b-instant",
    provider: "Budget Inference Co",
    price: 0.04,
    fee: 0.004,
    total: 0.044,
    latencyMs: 3902,
    inboundTx: "0.0.7162784@1785033720.106557648",
    paymentTx: "0.0.7162784@1785033722.072053534",
    ts: 1785033732063,
  };

  it("restores the money and both settlement transactions", () => {
    const e = tradeToEntry(msg(trade))!;
    expect(e.price).toBe(0.04);
    expect(e.fee).toBe(0.004);
    expect(e.total).toBe(0.044);
    expect(e.inboundRef).toBe(trade.inboundTx);
    expect(e.paymentRef).toBe(trade.paymentTx);
    expect(e.provider).toBe("Budget Inference Co");
    expect(e.ts).toBe(1785033732063);
    expect(e.status).toBe("ok");
  });

  it("marks the row as restored, since the prompt is not on the trade message", () => {
    // The feed must not imply it recovered content the ledger never carried.
    const e = tradeToEntry(msg(trade))!;
    expect(e.promptPreview).toContain("restored");
    expect(e.answerPreview).toBe("");
    expect(e.providerUrl).toBe("");
  });

  it("ignores messages that are not trades", () => {
    expect(tradeToEntry(msg({ type: "registration", account: "0.0.1" }))).toBeNull();
    expect(tradeToEntry(msg({ type: "refund", total: 1 }))).toBeNull();
    expect(tradeToEntry(msg(null))).toBeNull();
  });

  it("ignores a trade with no usable price rather than feeding NaN to the chart", () => {
    expect(tradeToEntry(msg({ ...trade, price: undefined }))).toBeNull();
    expect(tradeToEntry(msg({ ...trade, price: "0.04" }))).toBeNull();
  });

  it("tolerates older messages written before fee/total existed", () => {
    // The topic is append-only, so it still holds rows from earlier builds.
    const legacy = { type: "trade", model: "m", provider: "P", price: 0.1, paymentTx: "tx" };
    const e = tradeToEntry(msg(legacy, 7))!;
    expect(e.fee).toBe(0);
    expect(e.total).toBeCloseTo(0.1, 9);
    expect(e.latencyMs).toBe(0);
    expect(e.id).toBe("hcs-7");
  });

  it("falls back to the consensus timestamp when the payload has no ts", () => {
    const e = tradeToEntry(msg({ type: "trade", price: 0.05 }, 3, "1785033732.343117104"))!;
    expect(e.ts).toBe(1785033732343);
  });
});
