import { describe, it, expect } from "vitest";
import {
  hbarPrice,
  hashscanTx,
  hashscanAccount,
  hashscanTopic,
  HBAR_ASSET,
  HEDERA_NETWORK,
  USDC_TOKEN_ID,
  USDC_DECIMALS,
  TINYBAR,
  MIRROR_NODE,
  SETTLEMENT_ASSET,
} from "./hedera.js";

describe("hbarPrice", () => {
  it("converts whole and fractional HBAR to tinybar strings", () => {
    expect(hbarPrice(1)).toEqual({ amount: "100000000", asset: HBAR_ASSET });
    expect(hbarPrice(0.1)).toEqual({ amount: "10000000", asset: HBAR_ASSET });
    expect(hbarPrice(0.12)).toEqual({ amount: "12000000", asset: HBAR_ASSET });
    expect(hbarPrice(0)).toEqual({ amount: "0", asset: HBAR_ASSET });
  });

  it("rounds sub-tinybar amounts to the nearest tinybar", () => {
    // 0.000000014 ℏ = 1.4 tinybar -> 1 ; 0.000000015 ℏ = 1.5 -> 2
    expect(hbarPrice(0.000000014).amount).toBe("1");
    expect(hbarPrice(0.000000016).amount).toBe("2");
  });
});

describe("hashscan link builders", () => {
  it("builds testnet explorer URLs", () => {
    expect(hashscanTx("0.0.1@2.3")).toBe("https://hashscan.io/testnet/transaction/0.0.1@2.3");
    expect(hashscanAccount("0.0.42")).toBe("https://hashscan.io/testnet/account/0.0.42");
    expect(hashscanTopic("0.0.99")).toBe("https://hashscan.io/testnet/topic/0.0.99");
  });
});

describe("network constants", () => {
  it("exposes the expected Hedera testnet values", () => {
    expect(HEDERA_NETWORK).toBe("hedera:testnet");
    expect(HBAR_ASSET).toBe("0.0.0");
    expect(USDC_TOKEN_ID).toBe("0.0.429274");
    expect(USDC_DECIMALS).toBe(6);
    expect(TINYBAR).toBe(100_000_000);
    expect(MIRROR_NODE).toBe("https://testnet.mirrornode.hedera.com");
    expect(SETTLEMENT_ASSET).toBe("hbar"); // default when SETTLEMENT_ASSET is unset
  });
});
