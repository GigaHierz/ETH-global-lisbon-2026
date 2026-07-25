import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget } from "./budget.js";

test("starts empty with the full cap remaining", () => {
  const b = new Budget(2);
  assert.equal(b.spent, 0);
  assert.equal(b.remaining, 2);
});

test("canAfford reflects the remaining budget", () => {
  const b = new Budget(1);
  assert.equal(b.canAfford(0.5), true);
  assert.equal(b.canAfford(1), true);
  assert.equal(b.canAfford(1.0001), false);
});

test("record accumulates spend and shrinks remaining", () => {
  const b = new Budget(1);
  b.record(0.12);
  b.record(0.12);
  assert.equal(Number(b.spent.toFixed(4)), 0.24);
  assert.equal(Number(b.remaining.toFixed(4)), 0.76);
});

test("canAfford tightens after spending", () => {
  const b = new Budget(0.3);
  b.record(0.12);
  b.record(0.12);
  assert.equal(b.canAfford(0.12), false); // only 0.06 left
  assert.equal(b.canAfford(0.05), true);
});

test("record rejects a charge that exceeds the cap", () => {
  const b = new Budget(0.1);
  assert.throws(() => b.record(0.2), /budget/i);
  assert.equal(b.spent, 0); // unchanged after a rejected charge
});

test("rejects a non-positive cap and non-positive charges", () => {
  assert.throws(() => new Budget(0), /cap/i);
  const b = new Budget(1);
  assert.throws(() => b.record(0), /amount/i);
  assert.throws(() => b.record(-1), /amount/i);
});
