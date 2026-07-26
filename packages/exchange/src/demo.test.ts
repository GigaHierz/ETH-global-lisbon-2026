import { describe, it, expect, afterEach } from "vitest";
import type { ProviderRow } from "@agentrouter/shared";
import { applySlash } from "./slash.js";
import { applyReset, resolveCheaterWallet, demoTokenOk, DEMO_CHEATER_NAME } from "./demo.js";

function rows(): ProviderRow[] {
  return [
    {
      displayName: DEMO_CHEATER_NAME,
      model: "llama-3.3-70b-versatile",
      price: 0.08,
      wallet: "0.0.9755665",
      agentId: null,
      url: "http://localhost:4023",
      status: "live",
      reputation: 100,
      stakeHbar: 50,
      requestsServed: 3,
      bondTokens: 100,
      bondStatus: "active",
    },
    {
      displayName: "Titan Compute",
      model: "llama-3.3-70b-versatile",
      price: 0.1,
      wallet: "0.0.9755663",
      agentId: null,
      url: "http://localhost:4021",
      status: "live",
      reputation: 100,
      stakeHbar: 50,
      requestsServed: 5,
      bondTokens: 100,
      bondStatus: "active",
    },
  ];
}

afterEach(() => {
  delete process.env.DEMO_TOKEN;
  delete process.env.DEMO_CHEATER_WALLET;
});

describe("applyReset", () => {
  it("restores a slashed provider back to a healthy live baseline", () => {
    const list = rows();
    applySlash(list, { wallet: "0.0.9755665", amountHbar: 25 });
    list[0].bondStatus = "wiped";
    list[0].bondTokens = 0;

    const result = applyReset(list, { wallet: "0.0.9755665" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.status).toBe("live");
      expect(result.row.reputation).toBe(100);
      expect(result.row.stakeHbar).toBe(50);
      expect(result.row.bondStatus).toBe("active");
      expect(result.row.bondTokens).toBe(100);
    }
  });

  it("honors an explicit stakeHbar override", () => {
    const result = applyReset(rows(), { wallet: "0.0.9755665" }, { stakeHbar: 42 });
    expect(result.ok && result.row.stakeHbar).toBe(42);
  });

  it("matches the wallet case-insensitively", () => {
    expect(applyReset(rows(), { wallet: "0.0.9755665".toUpperCase() }).ok).toBe(true);
  });

  it("404s an unknown wallet and 400s a missing wallet", () => {
    expect(applyReset(rows(), { wallet: "0.0.nope" })).toEqual({ ok: false, status: 404, error: "unknown provider wallet" });
    expect(applyReset(rows(), {})).toMatchObject({ ok: false, status: 400 });
    expect(applyReset(rows(), { wallet: 123 })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("resolveCheaterWallet", () => {
  it("prefers an explicit body wallet", () => {
    expect(resolveCheaterWallet(rows(), "0.0.override")).toBe("0.0.override");
  });

  it("falls back to DEMO_CHEATER_WALLET env", () => {
    process.env.DEMO_CHEATER_WALLET = "0.0.fromenv";
    expect(resolveCheaterWallet(rows())).toBe("0.0.fromenv");
  });

  it("finally resolves the seeded cheater by display name", () => {
    expect(resolveCheaterWallet(rows())).toBe("0.0.9755665");
  });

  it("returns null when the cheater is not in the table", () => {
    expect(resolveCheaterWallet([rows()[1]])).toBeNull();
  });
});

describe("demoTokenOk", () => {
  it("allows any request when DEMO_TOKEN is unset (local dev)", () => {
    expect(demoTokenOk(undefined)).toBe(true);
    expect(demoTokenOk("whatever")).toBe(true);
  });

  it("requires an exact match when DEMO_TOKEN is set", () => {
    process.env.DEMO_TOKEN = "s3cret";
    expect(demoTokenOk("s3cret")).toBe(true);
    expect(demoTokenOk("wrong")).toBe(false);
    expect(demoTokenOk(undefined)).toBe(false);
  });
});
