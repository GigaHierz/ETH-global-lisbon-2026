import { describe, it, expect, afterEach } from "vitest";
import { bondTokenId, BOND_AMOUNT } from "./hts.js";

describe("bondTokenId", () => {
  afterEach(() => {
    delete process.env.HTS_BOND_TOKEN;
  });

  it("prefers the HTS_BOND_TOKEN env override", () => {
    process.env.HTS_BOND_TOKEN = "0.0.123456";
    expect(bondTokenId()).toBe("0.0.123456");
  });

  it("returns deployments.json bondToken (null until `pnpm setup-hts` runs) when no override", () => {
    // deployments.json ships with bondToken: null → resolver yields null, never throws.
    expect(bondTokenId()).toBeNull();
  });
});

describe("BOND_AMOUNT", () => {
  it("defaults to 100 ARBOND", () => {
    expect(BOND_AMOUNT).toBe(100);
  });
});
