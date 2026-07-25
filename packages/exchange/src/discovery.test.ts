import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_PROVIDER_URLS, type ProviderRow } from "@agentrouter/shared";
import { pickProvider, PROVIDER_URLS } from "./discovery.js";
import { providers } from "./state.js";

const M70 = "llama-3.3-70b-versatile";
const M8 = "llama-3.1-8b-instant";

function seed(rows: Array<Partial<ProviderRow> & { url: string }>) {
  providers.clear();
  for (const r of rows) {
    providers.set(r.url, {
      displayName: r.displayName ?? r.url,
      model: r.model ?? M70,
      priceHbar: r.priceHbar ?? 0.1,
      wallet: r.wallet ?? `0.0.${r.url}`,
      agentId: null,
      url: r.url,
      status: r.status ?? "live",
      reputation: 100,
      stakeHbar: 50,
      requestsServed: 0,
    });
  }
}

beforeEach(() => providers.clear());

describe("pickProvider", () => {
  it("returns the cheapest live provider claiming the model", () => {
    seed([
      { url: "a", priceHbar: 0.1 },
      { url: "b", priceHbar: 0.04, model: M8 }, // different model
      { url: "c", priceHbar: 0.06 },
    ]);
    expect(pickProvider(M70)?.url).toBe("c");
  });

  it("ignores down and slashed providers", () => {
    seed([
      { url: "cheap-but-slashed", priceHbar: 0.01, status: "slashed" },
      { url: "cheap-but-down", priceHbar: 0.02, status: "down" },
      { url: "live", priceHbar: 0.09 },
    ]);
    expect(pickProvider(M70)?.url).toBe("live");
  });

  it("returns undefined when no live provider serves the model", () => {
    seed([{ url: "only8b", priceHbar: 0.04, model: M8 }]);
    expect(pickProvider(M70)).toBeUndefined();
  });

  it("breaks price ties deterministically by url, regardless of insert order", () => {
    seed([
      { url: "http://z", priceHbar: 0.08 },
      { url: "http://a", priceHbar: 0.08 },
    ]);
    expect(pickProvider(M70)?.url).toBe("http://a");
    // reverse insertion order -> same winner
    seed([
      { url: "http://a", priceHbar: 0.08 },
      { url: "http://z", priceHbar: 0.08 },
    ]);
    expect(pickProvider(M70)?.url).toBe("http://a");
  });
});

describe("PROVIDER_URLS parsing", () => {
  it("defaults to the shared provider seed list", () => {
    expect(PROVIDER_URLS).toEqual(DEFAULT_PROVIDER_URLS);
  });

  it("splits, trims, and drops empty entries from the env override", async () => {
    vi.resetModules();
    vi.stubEnv("PROVIDER_URLS", " http://a , , http://b ,");
    const fresh = await import("./discovery.js");
    expect(fresh.PROVIDER_URLS).toEqual(["http://a", "http://b"]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
