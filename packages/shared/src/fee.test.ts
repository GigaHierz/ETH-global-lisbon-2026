import { describe, expect, it } from "vitest";
import { feeForPrice, totalForPrice, tinybarsOf, hbarOf } from "./hedera.js";

describe("exchange fee math (integer tinybars)", () => {
  it("computes 10% fee on 0.10 ℏ exactly", () => {
    const price = tinybarsOf(0.1); // 10_000_000
    expect(feeForPrice(price, 1000)).toBe(1_000_000); // 0.01 ℏ
    expect(totalForPrice(price, 1000)).toBe(11_000_000); // 0.11 ℏ
  });

  it("always rounds the fee UP (never underquotes)", () => {
    // 1 tinybar at 10% → ceil(0.1) = 1 tinybar fee
    expect(feeForPrice(1, 1000)).toBe(1);
    // 9999 tinybars at 1 bps → ceil(0.9999) = 1
    expect(feeForPrice(9999, 1)).toBe(1);
    // exact division stays exact
    expect(feeForPrice(10_000, 1)).toBe(1);
  });

  it("zero fee bps means total == price", () => {
    expect(totalForPrice(5_000_000, 0)).toBe(5_000_000);
  });

  it("round-trips hbar/tinybar at the display edge", () => {
    expect(hbarOf(totalForPrice(tinybarsOf(0.08), 1000))).toBeCloseTo(0.088, 9);
  });
});
