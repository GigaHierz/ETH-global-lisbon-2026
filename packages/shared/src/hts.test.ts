import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bondTokenId, BOND_AMOUNT } from "./hts.js";

describe("bondTokenId", () => {
  afterEach(() => {
    delete process.env.HTS_BOND_TOKEN;
  });

  it("prefers the HTS_BOND_TOKEN env override", () => {
    process.env.HTS_BOND_TOKEN = "0.0.123456";
    expect(bondTokenId()).toBe("0.0.123456");
  });

  it("falls back to deployments.json bondToken when no override (null before `pnpm setup-hts`)", () => {
    // Resolver returns whatever deployments.json holds — a 0.0.x id once setup-hts
    // has run, or null before then — and never throws.
    const deployed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "deployments.json"), "utf8"),
    ).hederaTestnet?.bondToken ?? null;
    expect(bondTokenId()).toBe(deployed);
  });
});

describe("BOND_AMOUNT", () => {
  it("defaults to 100 ARBOND", () => {
    expect(BOND_AMOUNT).toBe(100);
  });
});
