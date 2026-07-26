import { test } from "vitest";
import assert from "node:assert/strict";
import { liveModels, routeModel } from "./route-model.js";

const MARKET = [
  { model: "llama-3.1-8b-instant", price: 0.04, status: "live" },
  { model: "0gm-1.0-35b-a3b", price: 0.06, status: "live" },
  { model: "llama-3.3-70b-versatile", price: 0.08, status: "live" },
  { model: "llama-3.3-70b-versatile", price: 0.1, status: "live" }, // pricier duplicate
  { model: "dead-model", price: 0.01, status: "down" }, // never routable
];

test("liveModels dedupes to cheapest ask per model, ascending, live only", () => {
  const models = liveModels(MARKET);
  assert.deepEqual(models, [
    { model: "llama-3.1-8b-instant", price: 0.04 },
    { model: "0gm-1.0-35b-a3b", price: 0.06 },
    { model: "llama-3.3-70b-versatile", price: 0.08 },
  ]);
});

test("short factual question routes to the cheapest model", () => {
  const r = routeModel("Why are rainbows curved?", MARKET, "fallback");
  assert.equal(r.tier, "simple");
  assert.equal(r.model, "llama-3.1-8b-instant");
});

test("code prompt routes to the premium model", () => {
  const r = routeModel("Refactor this function:\n```ts\nconst x = 1;\n```", MARKET, "fallback");
  assert.equal(r.tier, "premium");
  assert.equal(r.model, "llama-3.3-70b-versatile");
});

test("reasoning keywords route to the premium model", () => {
  const r = routeModel("Prove step by step that sqrt(2) is irrational", MARKET, "fallback");
  assert.equal(r.tier, "premium");
});

test("long prompts route premium even without keywords", () => {
  const r = routeModel("a".repeat(601), MARKET, "fallback");
  assert.equal(r.tier, "premium");
});

test("general mid-length prose routes to the middle of the market", () => {
  const r = routeModel("Give me a plan for a weekend trip to Porto with food stops and a rough budget breakdown.", MARKET, "fallback");
  assert.equal(r.tier, "medium");
  assert.equal(r.model, "0gm-1.0-35b-a3b");
});

test("empty market falls back to the provided model", () => {
  const r = routeModel("hello?", [{ model: "x", price: 1, status: "down" }], "fallback-model");
  assert.equal(r.model, "fallback-model");
  assert.equal(r.reason, "no live providers — fallback model");
});

test("single-model market routes everything to that model", () => {
  const market = [{ model: "only-model", price: 0.05, status: "live" }];
  assert.equal(routeModel("hi?", market, "f").model, "only-model");
  assert.equal(routeModel("prove a theorem", market, "f").model, "only-model");
  assert.equal(routeModel("Tell me about the history of Lisbon and its neighborhoods in a couple of paragraphs please, covering Alfama and Belém.", market, "f").model, "only-model");
});
