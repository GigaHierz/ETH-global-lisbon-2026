import { test } from "node:test";
import assert from "node:assert/strict";
import { agentUaid, buildRegistration } from "./identity.js";

test("agentUaid builds an HCS-14 testnet UAID from an account id", () => {
  assert.equal(agentUaid("0.0.9746264"), "uaid:aid:hedera:testnet:0.0.9746264");
});

test("buildRegistration produces an HCS-14 buyer-agent record", () => {
  const r = buildRegistration("0.0.9746264", { displayName: "Demo Buyer", endpoint: "http://localhost:4200" });
  assert.equal(r.agentId, "uaid:aid:hedera:testnet:0.0.9746264");
  assert.equal(r.account, "0.0.9746264");
  assert.equal(r.standard, "HCS-14");
  assert.equal(r.role, "buyer");
  assert.equal(r.displayName, "Demo Buyer");
  assert.equal(r.endpoint, "http://localhost:4200");
});

test("registration type is distinct from a provider registration (won't be discovered as sellable)", () => {
  const r = buildRegistration("0.0.9746264", { displayName: "Demo Buyer", endpoint: "http://x" });
  assert.notEqual(r.type, "registration"); // providers use "registration"
  assert.equal(r.type, "agent-identity");
});
