import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuyResult } from "./buy.js";

const ok = {
  choices: [{ message: { role: "assistant", content: "Lisbon is the capital." } }],
  agentrouter: { provider: "Titan Compute", pricePaidHbar: 0.12, providerCostHbar: 0.1, marginHbar: 0.02 },
};

test("maps a well-formed exchange response into a BuyResult", () => {
  const r = parseBuyResult(ok, "0.0.9746264@123.456");
  assert.equal(r.answer, "Lisbon is the capital.");
  assert.equal(r.costHbar, 0.12); // what the agent paid the exchange (ask)
  assert.equal(r.provider, "Titan Compute");
  assert.equal(r.paymentRef, "0.0.9746264@123.456"); // the agent's own settle tx
});

test("throws when the completion has no content", () => {
  assert.throws(() => parseBuyResult({ choices: [], agentrouter: ok.agentrouter }, "tx"), /content/i);
});

test("throws when the ask price is missing", () => {
  const bad = { choices: ok.choices, agentrouter: { provider: "X" } };
  assert.throws(() => parseBuyResult(bad, "tx"), /pricePaidHbar/i);
});

test("defaults provider to 'unknown' when the exchange omits it", () => {
  const r = parseBuyResult({ choices: ok.choices, agentrouter: { pricePaidHbar: 0.12 } }, "tx");
  assert.equal(r.provider, "unknown");
});
