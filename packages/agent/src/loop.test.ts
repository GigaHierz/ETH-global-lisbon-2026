import { test } from "vitest";
import assert from "node:assert/strict";
import { Budget } from "./budget.js";
import { runGoal, type AgentEvent, type Brain, type BuyResult } from "./loop.js";

function fakeBrain(questions: string[]): Brain {
  return {
    plan: async () => questions,
    synthesize: async (_goal, findings) => `synth(${findings.map((f) => f.a).join("+")})`,
  };
}

function fakeBuy(costHbar: number) {
  return async (q: string): Promise<BuyResult> => ({
    answer: `A:${q}`,
    costHbar,
    provider: "Titan Compute",
    paymentRef: `tx-${q}`,
  });
}

test("happy path: plans, buys each question, synthesizes", async () => {
  const events: AgentEvent[] = [];
  const res = await runGoal("goal", {
    brain: fakeBrain(["q1", "q2", "q3"]),
    buy: fakeBuy(0.12),
    budget: new Budget(2),
    askHbar: 0.12,
    emit: (e) => events.push(e),
  });
  assert.equal(res.findings.length, 3);
  assert.equal(Number(res.spentHbar.toFixed(4)), 0.36);
  assert.equal(res.answer, "synth(A:q1+A:q2+A:q3)");
  assert.equal(events.filter((e) => e.type === "bought").length, 3);
  assert.equal(events.at(-1)?.type, "done");
});

test("stops buying when the budget can't cover the next ask", async () => {
  const events: AgentEvent[] = [];
  const res = await runGoal("goal", {
    brain: fakeBrain(["q1", "q2", "q3", "q4"]),
    buy: fakeBuy(0.12),
    budget: new Budget(0.3), // only 2 buys fit (0.24), 3rd (0.36) would exceed
    askHbar: 0.12,
    emit: (e) => events.push(e),
  });
  assert.equal(res.findings.length, 2);
  assert.equal(events.some((e) => e.type === "budget-exhausted"), true);
  // still synthesizes from the partial findings it could afford
  assert.equal(res.answer, "synth(A:q1+A:q2)");
});

test("emits a well-formed event sequence", async () => {
  const events: AgentEvent[] = [];
  await runGoal("goal", {
    brain: fakeBrain(["q1"]),
    buy: fakeBuy(0.1),
    budget: new Budget(1),
    askHbar: 0.12,
    emit: (e) => events.push(e),
  });
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["goal", "plan", "bought", "synthesis", "done"]);
  const bought = events.find((e) => e.type === "bought");
  assert.equal(bought && "provider" in bought && bought.provider, "Titan Compute");
});

test("records real cost against the budget, not the estimate", async () => {
  const budget = new Budget(1);
  await runGoal("goal", {
    brain: fakeBrain(["q1", "q2"]),
    buy: fakeBuy(0.1), // actual cost 0.1, ask estimate 0.12
    budget,
    askHbar: 0.12,
    emit: () => {},
  });
  assert.equal(Number(budget.spent.toFixed(4)), 0.2);
});
