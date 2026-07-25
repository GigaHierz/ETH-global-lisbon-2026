import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ProviderRow, RequestLogEntry } from "@agentrouter/shared";
import {
  providers,
  requestLog,
  priceIndex,
  providerList,
  pushRequest,
  addSSEClient,
  broadcast,
  revenue,
  statsSnapshot,
} from "./state.js";

function entry(i: number): RequestLogEntry {
  return {
    id: `e${i}`,
    ts: i,
    model: "llama-3.3-70b-versatile",
    provider: "Titan Compute",
    providerUrl: "http://localhost:4021",
    price: 0.1,
    fee: 0.01,
    total: 0.11,
    latencyMs: 5,
    paymentRef: `pay-${i}`,
    promptPreview: "q",
    answerPreview: "a",
    status: "ok",
  };
}

function row(url: string): ProviderRow {
  return {
    displayName: url,
    model: "llama-3.3-70b-versatile",
    price: 0.1,
    wallet: `0.0.${url}`,
    agentId: null,
    url,
    status: "live",
    reputation: 100,
    stakeHbar: 50,
    requestsServed: 0,
  };
}

beforeEach(() => {
  requestLog.length = 0;
  priceIndex.length = 0;
  providers.clear();
});

describe("pushRequest ring buffers", () => {
  it("caps the request log at 500, dropping the oldest", () => {
    for (let i = 0; i < 600; i++) pushRequest(entry(i));
    expect(requestLog.length).toBe(500);
    expect(requestLog[0].id).toBe("e100"); // e0..e99 evicted
    expect(requestLog.at(-1)!.id).toBe("e599");
  });

  it("caps the price index at 2000", () => {
    for (let i = 0; i < 2100; i++) pushRequest(entry(i));
    expect(priceIndex.length).toBe(2000);
    expect(priceIndex[0].ts).toBe(100); // first 100 price points evicted
  });
});

describe("providerList", () => {
  it("returns a snapshot of the provider map values", () => {
    providers.set("http://localhost:4021", row("http://localhost:4021"));
    providers.set("http://localhost:4022", row("http://localhost:4022"));
    expect(providerList().map((p) => p.url).sort()).toEqual([
      "http://localhost:4021",
      "http://localhost:4022",
    ]);
  });
});

describe("SSE fanout", () => {
  it("delivers events to subscribers and stops after unsubscribe", () => {
    const writes: string[] = [];
    const unsub = addSSEClient((chunk) => writes.push(chunk));
    broadcast({ type: "providers", providers: [] });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('data: {"type":"providers","providers":[]}\n\n');
    unsub();
    broadcast({ type: "providers", providers: [] });
    expect(writes).toHaveLength(1); // no further delivery
  });

  it("auto-evicts a client whose write throws", () => {
    const bad = vi.fn(() => {
      throw new Error("client gone");
    });
    const good: string[] = [];
    addSSEClient(bad);
    addSSEClient((c) => good.push(c));
    broadcast({ type: "slashed", provider: "X", amountHbar: 25, reason: "r" });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveLength(1);
    // bad was removed; a second broadcast never calls it again
    broadcast({ type: "slashed", provider: "Y", amountHbar: 1, reason: "r" });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveLength(2);
  });
});

describe("statsSnapshot", () => {
  beforeEach(() => {
    Object.assign(revenue, { volumeUnits: 0, feeUnits: 0, requests: 0, refunds: 0, refundFailures: 0 });
  });

  it("reports accrued revenue as decimals in the settlement asset", () => {
    // Revenue accrues in integer base units so it can never drift by a rounding
    // step; only this snapshot converts to a decimal for display.
    Object.assign(revenue, { volumeUnits: 300_000, feeUnits: 30_000, requests: 3 });
    const s = statsSnapshot();
    expect(s.totalVolume).toBeCloseTo(0.3, 9); // 300_000 micro-USDC
    expect(s.feeRevenue).toBeCloseTo(0.03, 9);
    expect(s.requests).toBe(3);
    expect(s.asset).toBe("USDC");
    expect(s.feeBps).toBe(1000);
  });

  it("carries refund counters through untouched", () => {
    Object.assign(revenue, { refunds: 2, refundFailures: 1 });
    expect(statsSnapshot()).toMatchObject({ refunds: 2, refundFailures: 1 });
  });
});
