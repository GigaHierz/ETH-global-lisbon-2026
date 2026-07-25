import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import { getTopicId, topicLinks } from "./hcs.js";

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
    expect(getTopicId("registry")).toBe("0.0.9744593");
    expect(getTopicId("trades")).toBe("0.0.9744594");
    expect(getTopicId("verdicts")).toBe("0.0.9744595");
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
      id: "0.0.9744593",
      hashscan: "https://hashscan.io/testnet/topic/0.0.9744593",
    });
    expect(links.trades.hashscan).toContain("0.0.9744594");
    expect(links.verdicts.id).toBe("0.0.9744595");
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
