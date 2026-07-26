import { describe, it, expect } from "vitest";
import { pickRow } from "./verify.js";
import type { ProviderRow } from "@agentrouter/shared";

// The exchange keys its provider table by URL, so one wallet can have several rows.
// Every endpoint change leaves the old URL behind as a stale `down` row — picking the
// first wallet match would report `down` for a provider that is actually live.
const WALLET = "0.0.9755667";
const row = (url: string, status: ProviderRow["status"], wallet = WALLET): ProviderRow => ({
  displayName: "QA", model: "llama-3.3-70b-versatile", priceHbar: 0.1,
  wallet, agentId: `uaid:aid:hedera:testnet:${wallet}`, url,
  status, reputation: 100, stakeHbar: 50, requestsServed: 0,
});

describe("pickRow", () => {
  it("returns null when the wallet has no rows", () => {
    expect(pickRow([row("https://a.tld", "live", "0.0.1")], WALLET)).toBeNull();
    expect(pickRow([], WALLET)).toBeNull();
  });

  it("prefers the row matching the endpoint we asked about", () => {
    const list = [row("https://stale.tld", "down"), row("http://localhost:4098", "live")];
    expect(pickRow(list, WALLET, "http://localhost:4098")?.url).toBe("http://localhost:4098");
  });

  it("ignores a trailing slash when matching the endpoint", () => {
    const list = [row("https://stale.tld", "down"), row("https://acme.tld", "live")];
    expect(pickRow(list, WALLET, "https://acme.tld/")?.url).toBe("https://acme.tld");
  });

  it("prefers a live row over a stale down row when no URL is given", () => {
    // REGRESSION: taking the first wallet match reported `down` for a live provider.
    const list = [row("https://stale.tld", "down"), row("http://localhost:4098", "live")];
    expect(pickRow(list, WALLET)?.status).toBe("live");
  });

  it("still reports the real status when nothing is live", () => {
    const list = [row("https://a.tld", "down"), row("https://b.tld", "slashed")];
    expect(pickRow(list, WALLET)?.status).toBe("down");
  });

  it("surfaces a slashed provider rather than hiding it", () => {
    expect(pickRow([row("https://a.tld", "slashed")], WALLET)?.status).toBe("slashed");
  });

  it("matches the wallet case-insensitively", () => {
    expect(pickRow([row("https://a.tld", "live", WALLET.toUpperCase())], WALLET.toLowerCase())).not.toBeNull();
  });

  it("falls back to a wallet match when the asked-about URL isn't in the table yet", () => {
    const list = [row("https://old.tld", "down")];
    expect(pickRow(list, WALLET, "https://brand-new.tld")?.url).toBe("https://old.tld");
  });
});
