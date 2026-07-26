import { describe, it, expect, afterEach, vi } from "vitest";
import {
  hbarPrice,
  settlementPrice,
  money,
  hashscanTx,
  hashscanAccount,
  hashscanTopic,
  HBAR_ASSET,
  HEDERA_NETWORK,
  TINYBAR,
  MIRROR_NODE,
  USDC_TOKEN_ID,
  USDC_DECIMALS,
  SETTLEMENT_ASSET,
  ASSET_LABEL,
  ASSET_SYMBOL,
  SCHEME_CONFIG,
} from "./hedera.js";

// SETTLEMENT_ASSET is read once at module load, so the non-default branch can only be
// reached by resetting the module registry and re-importing under a stubbed env.
async function loadWith(asset: string | undefined) {
  vi.resetModules();
  vi.stubEnv("SETTLEMENT_ASSET", asset as string);
  return import("./hedera.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

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
    expect(TINYBAR).toBe(100_000_000);
    expect(MIRROR_NODE).toBe("https://testnet.mirrornode.hedera.com");
  });

  it("exposes the Hedera testnet USDC token", () => {
    expect(USDC_TOKEN_ID).toBe("0.0.429274");
    expect(USDC_DECIMALS).toBe(6);
  });
});

describe("settlement asset", () => {
  it("defaults to USDC", () => {
    expect(SETTLEMENT_ASSET).toBe("usdc");
    expect(ASSET_LABEL).toBe("USDC");
    expect(ASSET_SYMBOL).toBe("$");
  });

  it("passes USDC prices through as a bare Money value", () => {
    // The x402 Hedera scheme resolves a bare Money value to the network's default HTS
    // token, so we must NOT pre-convert to base units here or it would double-convert.
    expect(settlementPrice(0.12)).toBe(0.12);
    expect(settlementPrice(0)).toBe(0);
  });

  it("pins USDC explicitly in the server scheme config", () => {
    expect(SCHEME_CONFIG).toEqual({
      defaultAssets: { "hedera:testnet": { asset: "0.0.429274", decimals: 6 } },
    });
  });

  it("SETTLEMENT_ASSET=hbar switches to explicit tinybar AssetAmounts", async () => {
    const hbarMode = await loadWith("hbar");
    expect(hbarMode.SETTLEMENT_ASSET).toBe("hbar");
    expect(hbarMode.ASSET_LABEL).toBe("HBAR");
    expect(hbarMode.ASSET_SYMBOL).toBe("ℏ");
    expect(hbarMode.settlementPrice(0.1)).toEqual({ amount: "10000000", asset: "0.0.0" });
    // HBAR has no default-asset entry: the scheme would reject 0.0.0 as a Money target.
    expect(hbarMode.SCHEME_CONFIG).toEqual({});
  });

  it("formats USDC with a leading symbol", () => {
    expect(money(0.12)).toBe("$0.12");
    expect(money("1.2500")).toBe("$1.2500");
  });

  it("formats HBAR with a trailing symbol", async () => {
    // The two assets read the opposite way round, so this is a real branch, not cosmetics.
    const hbarMode = await loadWith("hbar");
    expect(hbarMode.money(0.12)).toBe("0.12 ℏ");
  });

  it("accepts HBAR case-insensitively and with stray whitespace", async () => {
    const fresh = await loadWith("  HBAR \n");
    expect(fresh.SETTLEMENT_ASSET).toBe("hbar");
  });

  // `SETTLEMENT_ASSET=` with no value is a normal thing to leave in a .env, and an
  // unrecognised value should fail safe rather than half-configure the stack.
  it.each([undefined, "", "   ", "ether"])("falls back to USDC for %o", async (value) => {
    const fresh = await loadWith(value);
    expect(fresh.SETTLEMENT_ASSET).toBe("usdc");
    expect(fresh.settlementPrice(0.05)).toBe(0.05);
  });
});
