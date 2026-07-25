import { describe, it, expect } from "vitest";
import type { ProviderRow } from "@agentrouter/shared";
import { applySlash } from "./slash.js";

function rows(): ProviderRow[] {
  return [
    {
      displayName: "SketchyGPU Labs",
      model: "llama-3.3-70b-versatile",
      priceHbar: 0.08,
      wallet: "0.0.9746383",
      agentId: null,
      url: "http://localhost:4023",
      status: "live",
      reputation: 100,
      stakeHbar: 50,
      requestsServed: 3,
      bondTokens: 100,
      bondStatus: "active",
    },
  ];
}

describe("applySlash", () => {
  it("slashes a matched provider: status, reputation, and reduced stake", () => {
    const list = rows();
    const result = applySlash(list, { wallet: "0.0.9746383", amountHbar: 25, reason: "fraud" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.status).toBe("slashed");
      expect(result.row.reputation).toBe(0);
      expect(result.row.stakeHbar).toBe(25);
    }
  });

  it("matches the wallet case-insensitively", () => {
    const result = applySlash(rows(), { wallet: "0.0.9746383".toUpperCase(), amountHbar: 10 });
    expect(result.ok).toBe(true);
  });

  it("floors stake at zero when the slash exceeds the stake", () => {
    const list = rows();
    const result = applySlash(list, { wallet: "0.0.9746383", amountHbar: 1000 });
    expect(result.ok && result.row.stakeHbar).toBe(0);
  });

  it("404s an unknown wallet", () => {
    const result = applySlash(rows(), { wallet: "0.0.doesnotexist", amountHbar: 25 });
    expect(result).toEqual({ ok: false, status: 404, error: "unknown provider wallet" });
  });

  it("400s a missing or non-string wallet", () => {
    expect(applySlash(rows(), { amountHbar: 25 })).toMatchObject({ ok: false, status: 400 });
    expect(applySlash(rows(), { wallet: "", amountHbar: 25 })).toMatchObject({ ok: false, status: 400 });
    expect(applySlash(rows(), { wallet: 123, amountHbar: 25 })).toMatchObject({ ok: false, status: 400 });
  });

  it("400s a non-positive or non-finite amountHbar (a negative would inflate the stake)", () => {
    const before = rows();
    for (const amt of [0, -5, Number.NaN, Infinity, "25" as unknown as number]) {
      const result = applySlash(before, { wallet: "0.0.9746383", amountHbar: amt });
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
    // stake never changed on a rejected request
    expect(before[0].stakeHbar).toBe(50);
    expect(before[0].status).toBe("live");
  });
});
