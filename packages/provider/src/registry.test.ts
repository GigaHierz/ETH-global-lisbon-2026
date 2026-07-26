import { describe, it, expect } from "vitest";
import { isLocal } from "./registry.js";

// isLocal gates the one rule that keeps a provider routable: a boot that lost
// PROVIDER_PUBLIC_URL must never republish localhost over a good public registration.
describe("isLocal", () => {
  it("recognises endpoints only the local box can reach", () => {
    expect(isLocal("http://localhost:4025")).toBe(true);
    expect(isLocal("http://127.0.0.1:4025")).toBe(true);
    expect(isLocal("http://[::1]:4025")).toBe(true);
    expect(isLocal("https://localhost")).toBe(true);
    expect(isLocal("http://localhost/v1")).toBe(true);
  });

  it("treats real public endpoints as routable", () => {
    expect(isLocal("https://acme.up.railway.app")).toBe(false);
    expect(isLocal("https://tunnel.trycloudflare.com")).toBe(false);
    expect(isLocal("http://203.0.113.9:4025")).toBe(false);
  });

  it("does not mistake a hostname that merely contains 'localhost'", () => {
    expect(isLocal("https://localhost.acme.tld")).toBe(false);
    expect(isLocal("https://not-localhost.tld")).toBe(false);
  });

  it("is false for a missing endpoint, so a first registration is never blocked", () => {
    expect(isLocal(undefined)).toBe(false);
    expect(isLocal("")).toBe(false);
  });
});
