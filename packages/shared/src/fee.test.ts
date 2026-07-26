import { describe, expect, it, afterEach, vi } from "vitest";
import {
  feeForPrice,
  totalForPrice,
  baseUnitsOf,
  fromBaseUnits,
  settlementPriceFromUnits,
  ASSET_DECIMALS,
} from "./hedera.js";

async function loadWith(asset: string) {
  vi.resetModules();
  vi.stubEnv("SETTLEMENT_ASSET", asset);
  return import("./hedera.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The arithmetic never sees an asset — it works on whatever integer base unit it is
// handed. That is what lets the same fee code serve 6-dp USDC and 8-dp HBAR.
describe("exchange fee math (scale-agnostic integers)", () => {
  it("computes a 10% fee exactly at either scale", () => {
    expect(feeForPrice(10_000_000, 1000)).toBe(1_000_000); // 0.10 ℏ → 0.01 ℏ
    expect(totalForPrice(10_000_000, 1000)).toBe(11_000_000);
    expect(feeForPrice(100_000, 1000)).toBe(10_000); // $0.10 → $0.01
    expect(totalForPrice(100_000, 1000)).toBe(110_000);
  });

  it("always rounds the fee UP (never underquotes)", () => {
    expect(feeForPrice(1, 1000)).toBe(1); // ceil(0.1) → 1
    expect(feeForPrice(9999, 1)).toBe(1); // ceil(0.9999) → 1
    expect(feeForPrice(10_000, 1)).toBe(1); // exact division stays exact
  });

  it("zero fee bps means total == price", () => {
    expect(totalForPrice(5_000_000, 0)).toBe(5_000_000);
  });
});

describe("base-unit conversion follows the settlement asset", () => {
  it("uses 6 dp under USDC (the default)", () => {
    expect(ASSET_DECIMALS).toBe(6);
    expect(baseUnitsOf(0.1)).toBe(100_000);
    expect(fromBaseUnits(110_000)).toBeCloseTo(0.11, 9);
  });

  it("uses 8 dp under HBAR", async () => {
    const hbar = await loadWith("hbar");
    expect(hbar.ASSET_DECIMALS).toBe(8);
    expect(hbar.baseUnitsOf(0.1)).toBe(10_000_000);
    expect(hbar.fromBaseUnits(11_000_000)).toBeCloseTo(0.11, 9);
  });

  it("round-trips a price-plus-fee total in both assets", async () => {
    expect(fromBaseUnits(totalForPrice(baseUnitsOf(0.08), 1000))).toBeCloseTo(0.088, 9);
    const hbar = await loadWith("hbar");
    expect(hbar.fromBaseUnits(hbar.totalForPrice(hbar.baseUnitsOf(0.08), 1000))).toBeCloseTo(0.088, 9);
  });
});

describe("settlementPriceFromUnits", () => {
  it("hands x402 the exact integer against the USDC token", () => {
    expect(settlementPriceFromUnits(110_000)).toEqual({ amount: "110000", asset: "0.0.429274" });
  });

  it("hands x402 tinybars against the native asset under HBAR", async () => {
    const hbar = await loadWith("hbar");
    expect(hbar.settlementPriceFromUnits(11_000_000)).toEqual({ amount: "11000000", asset: "0.0.0" });
  });
});
