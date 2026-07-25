// The buyer agent's reasoning loop. Given a goal, it plans sub-questions, buys
// an answer to each through the exchange (real x402 HBAR), and synthesizes a
// final result — stopping early the moment the budget can't cover the next buy.
//
// Pure orchestration: brain (LLM), buy (paid inference call), and budget are
// injected, so the control flow is unit-tested without a live provider or chain.

import type { Budget } from "./budget.js";

export interface Finding {
  q: string;
  a: string;
}

export interface BuyResult {
  answer: string;
  cost: number;
  provider: string;
  paymentRef: string;
}

export interface Brain {
  /** Break the goal into a short list of sub-questions to buy answers for. */
  plan(goal: string): Promise<string[]>;
  /** Combine the bought answers into a final result. */
  synthesize(goal: string, findings: Finding[]): Promise<string>;
}

export type AgentEvent =
  | { type: "goal"; goal: string }
  | { type: "plan"; questions: string[] }
  | {
      type: "bought";
      question: string;
      answer: string;
      cost: number;
      provider: string;
      paymentRef: string;
      remaining: number;
    }
  | { type: "budget-exhausted"; remaining: number }
  | { type: "synthesis"; answer: string }
  | { type: "done"; spent: number; findings: number };

export interface RunDeps {
  brain: Brain;
  buy: (question: string) => Promise<BuyResult>;
  budget: Budget;
  ask: number; // expected per-request ask, used to check affordability before buying
  emit: (event: AgentEvent) => void;
}

export interface RunResult {
  answer: string;
  findings: Finding[];
  spent: number;
}

export async function runGoal(goal: string, deps: RunDeps): Promise<RunResult> {
  const { brain, buy, budget, ask, emit } = deps;

  emit({ type: "goal", goal });

  const questions = await brain.plan(goal);
  emit({ type: "plan", questions });

  const findings: Finding[] = [];
  for (const q of questions) {
    if (!budget.canAfford(ask)) {
      emit({ type: "budget-exhausted", remaining: budget.remaining });
      break;
    }
    const r = await buy(q);
    budget.record(r.cost);
    findings.push({ q, a: r.answer });
    emit({
      type: "bought",
      question: q,
      answer: r.answer,
      cost: r.cost,
      provider: r.provider,
      paymentRef: r.paymentRef,
      remaining: budget.remaining,
    });
  }

  const answer = await brain.synthesize(goal, findings);
  emit({ type: "synthesis", answer });
  emit({ type: "done", spent: budget.spent, findings: findings.length });

  return { answer, findings, spent: budget.spent };
}
