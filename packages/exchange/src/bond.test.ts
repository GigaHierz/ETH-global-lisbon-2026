import { describe, it, expect } from "vitest";
import type { ProviderRow } from "@agentrouter/shared";
import { applyBondEvent } from "./bond.js";

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

describe("applyBondEvent", () => {
  it("freezes a matched provider's bond, keeping the balance", () => {
    const list = rows();
    const result = applyBondEvent(list, { wallet: "0.0.9746383", bondStatus: "frozen", bondTokens: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.bondStatus).toBe("frozen");
      expect(result.row.bondTokens).toBe(100);
    }
  });

  it("zeroes the bond on a wipe even without an explicit count", () => {
    const result = applyBondEvent(rows(), { wallet: "0.0.9746383", bondStatus: "wiped" });
    expect(result.ok && result.row.bondStatus).toBe("wiped");
    expect(result.ok && result.row.bondTokens).toBe(0);
  });

  it("matches the wallet case-insensitively", () => {
    const result = applyBondEvent(rows(), { wallet: "0.0.9746383".toUpperCase(), bondStatus: "frozen" });
    expect(result.ok).toBe(true);
  });

  it("404s an unknown wallet", () => {
    const result = applyBondEvent(rows(), { wallet: "0.0.nope", bondStatus: "frozen" });
    expect(result).toEqual({ ok: false, status: 404, error: "unknown provider wallet" });
  });

  it("400s a missing wallet or an invalid bondStatus", () => {
    expect(applyBondEvent(rows(), { bondStatus: "frozen" })).toMatchObject({ ok: false, status: 400 });
    expect(applyBondEvent(rows(), { wallet: "0.0.9746383", bondStatus: "melted" })).toMatchObject({ ok: false, status: 400 });
    expect(applyBondEvent(rows(), { wallet: "0.0.9746383" })).toMatchObject({ ok: false, status: 400 });
  });
});
