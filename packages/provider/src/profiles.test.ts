import { describe, it, expect, afterEach, vi } from "vitest";
import { DEFAULT_MODEL, SMALL_MODEL, PROVIDER_PORTS } from "@agentrouter/shared";
import { PROFILES, resolveProfile } from "./profiles.js";

const savedArgv = process.argv;

afterEach(() => {
  process.argv = savedArgv;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("PROFILES", () => {
  it("provider1 (Titan) is an honest 70b on the first port", () => {
    const p = PROFILES.provider1;
    expect(p.advertisedModel).toBe(DEFAULT_MODEL);
    expect(p.actualModel).toBe(DEFAULT_MODEL);
    expect(p.price).toBe(0.1);
    expect(p.port).toBe(PROVIDER_PORTS[0]);
    expect(p.cannedCheat).toBe(false);
  });

  it("provider2 (Budget) is an honest 8b", () => {
    expect(PROFILES.provider2.advertisedModel).toBe(SMALL_MODEL);
    expect(PROFILES.provider2.actualModel).toBe(SMALL_MODEL);
    expect(PROFILES.provider2.port).toBe(PROVIDER_PORTS[1]);
  });

  it("provider3 (SketchyGPU) advertises 70b and undercuts on price", () => {
    const p = PROFILES.provider3;
    expect(p.advertisedModel).toBe(DEFAULT_MODEL);
    expect(p.price).toBe(0.08); // cheaper than Titan's 0.10
    expect(p.port).toBe(PROVIDER_PORTS[2]);
  });

  it("provider4 (NimbusAI) is honest 70b, cheaper than Titan but plays fair", () => {
    const p = PROFILES.provider4;
    expect(p.advertisedModel).toBe(DEFAULT_MODEL);
    expect(p.actualModel).toBe(DEFAULT_MODEL);
    expect(p.price).toBe(0.06);
    expect(p.port).toBe(PROVIDER_PORTS[3]);
  });

  it("provider3 secretly serves the small model when CHEAT_MODE=true", async () => {
    vi.resetModules();
    vi.stubEnv("CHEAT_MODE", "true");
    const fresh = await import("./profiles.js");
    expect(fresh.PROFILES.provider3.actualModel).toBe(SMALL_MODEL);
    expect(fresh.PROFILES.provider3.cannedCheat).toBe(true);
    // honest providers are unaffected
    expect(fresh.PROFILES.provider1.actualModel).toBe(DEFAULT_MODEL);
  });
});

describe("resolveProfile", () => {
  it("resolves a --profile CLI flag", () => {
    process.argv = ["node", "index.ts", "--profile", "provider1"];
    expect(resolveProfile().key).toBe("provider1");
  });

  it("falls back to the PROVIDER_PROFILE env var", () => {
    process.argv = ["node", "index.ts"];
    vi.stubEnv("PROVIDER_PROFILE", "provider2");
    expect(resolveProfile().key).toBe("provider2");
  });

  it("exits on an unknown profile", () => {
    process.argv = ["node", "index.ts", "--profile", "nope"];
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    resolveProfile();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("builds a fully env-driven custom profile", () => {
    process.argv = ["node", "index.ts", "--profile", "custom"];
    vi.stubEnv("PROVIDER_NAME", "My GPU Box");
    vi.stubEnv("PROVIDER_MODEL", SMALL_MODEL);
    vi.stubEnv("PROVIDER_PRICE", "0.03");
    vi.stubEnv("PROVIDER_PORT", "4099");
    const p = resolveProfile();
    expect(p.key).toBe("custom");
    expect(p.displayName).toBe("My GPU Box");
    expect(p.price).toBe(0.03);
    expect(p.port).toBe(4099);
    expect(p.hederaRole).toBe("PROVIDER");
    // a custom provider is honest by construction: it serves what it advertises
    expect(p.actualModel).toBe(p.advertisedModel);
    expect(p.cannedCheat).toBe(false);
  });

  it("defaults every custom-profile field when nothing is set", () => {
    process.argv = ["node", "index.ts", "--profile", "custom"];
    const p = resolveProfile();
    expect(p.displayName).toBe("Custom Provider");
    expect(p.advertisedModel).toBe(DEFAULT_MODEL);
    expect(p.price).toBe(0.1);
    expect(p.port).toBe(4025);
  });

  it("exits when no profile is specified at all", () => {
    process.argv = ["node", "index.ts"];
    vi.stubEnv("PROVIDER_PROFILE", ""); // neither flag nor env
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    resolveProfile();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
