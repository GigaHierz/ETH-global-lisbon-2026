import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import { getTopicId, topicLinks } from "./hcs.js";

// Read the expected ids from deployments.json rather than hardcoding them. These
// tests are about the resolution *mechanism* (env var wins, file is the fallback),
// not about which topics happen to be live — hardcoding meant every topic rotation
// broke CI for a reason unrelated to the code under test.
const TOPICS: Record<string, string> = JSON.parse(
  fs.readFileSync("deployments.json", "utf8"),
).hederaTestnet.topics;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getTopicId", () => {
  it("prefers the HCS_<NAME>_TOPIC env var over deployments.json", () => {
    vi.stubEnv("HCS_REGISTRY_TOPIC", "0.0.env-override");
    expect(getTopicId("registry")).toBe("0.0.env-override");
  });

  it("falls back to deployments.json when the env var is unset", () => {
    vi.stubEnv("HCS_REGISTRY_TOPIC", "");
    // Runs from the repo root, where deployments.json defines the real topics.
    expect(getTopicId("registry")).toBe(TOPICS.registry);
    expect(getTopicId("trades")).toBe(TOPICS.trades);
    expect(getTopicId("verdicts")).toBe(TOPICS.verdicts);
  });

  it("returns null when deployments.json can't be read", () => {
    vi.stubEnv("HCS_TRADES_TOPIC", "");
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(getTopicId("trades")).toBeNull();
  });

  it("returns null when deployments.json has no matching topic", () => {
    vi.stubEnv("HCS_VERDICTS_TOPIC", "");
    vi.spyOn(fs, "readFileSync").mockReturnValue("{}");
    expect(getTopicId("verdicts")).toBeNull();
  });
});

describe("topicLinks", () => {
  it("maps every topic to its id + hashscan link", () => {
    vi.stubEnv("HCS_REGISTRY_TOPIC", "");
    vi.stubEnv("HCS_TRADES_TOPIC", "");
    vi.stubEnv("HCS_VERDICTS_TOPIC", "");
    const links = topicLinks();
    expect(links.registry).toEqual({
      id: TOPICS.registry,
      hashscan: `https://hashscan.io/testnet/topic/${TOPICS.registry}`,
    });
    expect(links.trades.hashscan).toContain(TOPICS.trades);
    expect(links.verdicts.id).toBe(TOPICS.verdicts);
  });

  it("yields null id + null hashscan when topics can't resolve", () => {
    vi.stubEnv("HCS_REGISTRY_TOPIC", "");
    vi.stubEnv("HCS_TRADES_TOPIC", "");
    vi.stubEnv("HCS_VERDICTS_TOPIC", "");
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const links = topicLinks();
    expect(links.registry).toEqual({ id: null, hashscan: null });
    expect(links.verdicts).toEqual({ id: null, hashscan: null });
  });
});
