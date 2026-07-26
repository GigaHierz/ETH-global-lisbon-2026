// Regression tests for the endpoint-clobber guard in ensureRegistered().
//
// The failure being prevented: a boot that lost PROVIDER_PUBLIC_URL derives
// http://localhost:<port>, sees an endpoint different from the cached one, and
// republishes localhost over a good public registration. The exchange reads the
// registry topic last-write-wins, so the provider drops to `down` — and it flips
// back on every restart.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const publish = vi.fn(async () => "0.0.7@new.registration");
const logs: string[] = [];

vi.mock("@agentrouter/shared", () => ({
  MOCK_MODE: false,
  hederaAccount: () => ({ id: ACCOUNT, key: "0xkey" }),
  publishToTopic: (...a: unknown[]) => publish(...(a as [])),
  hashscanTx: (t: string) => `https://hashscan.io/testnet/transaction/${t}`,
  log: (_k: string, m: string) => logs.push(m),
}));

const ACCOUNT = "0.0.4242";
const PUBLIC_URL = "https://acme.up.railway.app";
const CACHED_TX = "0.0.7@existing.registration";

const profile = {
  key: "custom", displayName: "Acme", port: 4025,
  advertisedModel: "llama-3.3-70b-versatile", actualModel: "llama-3.3-70b-versatile",
  priceHbar: 0.1, hederaRole: "PROVIDER", cannedCheat: false,
} as never;

let dir: string, cwd: string;

/** Seed .registry-cache.json in an isolated cwd — that's where the service reads it. */
function seedCache(endpoint: string) {
  writeFileSync(
    join(dir, ".registry-cache.json"),
    JSON.stringify({ [ACCOUNT]: { staked: "0.0.7@stake", registered: CACHED_TX, endpoint } }),
  );
}
const readCache = () => JSON.parse(readFileSync(join(dir, ".registry-cache.json"), "utf8"))[ACCOUNT];

beforeEach(() => {
  publish.mockClear();
  logs.length = 0;
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "registry-guard-"));
  process.chdir(dir);
  vi.resetModules();
  delete process.env.PROVIDER_PUBLIC_URL;
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PROVIDER_PUBLIC_URL;
});

describe("ensureRegistered endpoint guard", () => {
  it("does NOT republish localhost over a public registration when PROVIDER_PUBLIC_URL is lost", async () => {
    seedCache(PUBLIC_URL);
    // no PROVIDER_PUBLIC_URL -> the service derives http://localhost:4025
    const { ensureRegistered } = await import("./registry.js");

    await ensureRegistered(profile);

    expect(publish).not.toHaveBeenCalled();
    expect(readCache().registered).toBe(CACHED_TX);
    expect(readCache().endpoint).toBe(PUBLIC_URL); // public endpoint preserved
    expect(logs.join("\n")).toMatch(/PROVIDER_PUBLIC_URL is unset/);
  });

  it("still re-registers when upgrading localhost -> public", async () => {
    seedCache("http://localhost:4025");
    process.env.PROVIDER_PUBLIC_URL = PUBLIC_URL;
    const { ensureRegistered } = await import("./registry.js");

    await ensureRegistered(profile);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(readCache().endpoint).toBe(PUBLIC_URL);
  });

  it("still re-registers when moving between two public endpoints", async () => {
    seedCache(PUBLIC_URL);
    process.env.PROVIDER_PUBLIC_URL = "https://acme-v2.up.railway.app";
    const { ensureRegistered } = await import("./registry.js");

    await ensureRegistered(profile);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(readCache().endpoint).toBe("https://acme-v2.up.railway.app");
  });

  it("is a no-op when the endpoint is unchanged", async () => {
    seedCache(PUBLIC_URL);
    process.env.PROVIDER_PUBLIC_URL = PUBLIC_URL;
    const { ensureRegistered } = await import("./registry.js");

    await ensureRegistered(profile);

    expect(publish).not.toHaveBeenCalled();
    expect(readCache().registered).toBe(CACHED_TX);
  });

  it("registers normally on a first boot with a public URL", async () => {
    // staked already, so the test never touches the Hedera SDK
    writeFileSync(join(dir, ".registry-cache.json"), JSON.stringify({ [ACCOUNT]: { staked: "0.0.7@stake" } }));
    process.env.PROVIDER_PUBLIC_URL = PUBLIC_URL;
    const { ensureRegistered } = await import("./registry.js");

    const out = await ensureRegistered(profile);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(out.wallet).toBe(ACCOUNT);
    expect(out.agentId).toBe(`uaid:aid:hedera:testnet:${ACCOUNT}`);
    expect(readCache().endpoint).toBe(PUBLIC_URL);
  });

  it("publishes the endpoint it actually cached, never a mix of the two", async () => {
    seedCache(PUBLIC_URL);
    const { ensureRegistered } = await import("./registry.js");

    await ensureRegistered(profile);

    // Guard fired: nothing published, and the cache still describes the public endpoint.
    expect(publish).not.toHaveBeenCalled();
    expect(existsSync(join(dir, ".registry-cache.json"))).toBe(true);
    expect(readCache().endpoint).not.toMatch(/localhost/);
  });
});
