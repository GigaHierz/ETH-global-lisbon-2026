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
      price: r.price ?? 0.1,
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
      { url: "a", price: 0.1 },
      { url: "b", price: 0.04, model: M8 }, // different model
      { url: "c", price: 0.06 },
    ]);
    expect(pickProvider(M70)?.url).toBe("c");
  });

  it("ignores down and slashed providers", () => {
    seed([
      { url: "cheap-but-slashed", price: 0.01, status: "slashed" },
      { url: "cheap-but-down", price: 0.02, status: "down" },
      { url: "live", price: 0.09 },
    ]);
    expect(pickProvider(M70)?.url).toBe("live");
  });

  it("returns undefined when no live provider serves the model", () => {
    seed([{ url: "only8b", price: 0.04, model: M8 }]);
    expect(pickProvider(M70)).toBeUndefined();
  });

  it("skips live providers with an unusable price instead of routing to them", () => {
    // A provider serving a /info without a usable `price` would otherwise land in the
    // table with price undefined; the cheapest-first comparator then degrades to NaN,
    // which silently scrambles routing order rather than failing loudly.
    seed([{ url: "good", price: 0.09 }]);
    for (const bad of [undefined, NaN]) {
      providers.set("bad", {
        displayName: "bad", model: M70, price: bad as unknown as number,
        wallet: "0.0.bad", agentId: null, url: "bad",
        status: "live", reputation: 100, stakeHbar: 50, requestsServed: 0,
      });
      expect(pickProvider(M70)?.url).toBe("good");
    }
  });

  it("breaks price ties deterministically by url, regardless of insert order", () => {
    seed([
      { url: "http://z", price: 0.08 },
      { url: "http://a", price: 0.08 },
    ]);
    expect(pickProvider(M70)?.url).toBe("http://a");
    // reverse insertion order -> same winner
    seed([
      { url: "http://a", price: 0.08 },
      { url: "http://z", price: 0.08 },
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
