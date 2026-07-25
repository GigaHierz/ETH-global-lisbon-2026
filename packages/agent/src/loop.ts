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
  costHbar: number;
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
      costHbar: number;
      provider: string;
      paymentRef: string;
      remainingHbar: number;
    }
  | { type: "budget-exhausted"; remainingHbar: number }
  | { type: "synthesis"; answer: string }
  | { type: "done"; spentHbar: number; findings: number };

export interface RunDeps {
  brain: Brain;
  buy: (question: string) => Promise<BuyResult>;
  budget: Budget;
  askHbar: number; // expected per-request ask, used to check affordability before buying
  emit: (event: AgentEvent) => void;
}

export interface RunResult {
  answer: string;
  findings: Finding[];
  spentHbar: number;
}

export async function runGoal(goal: string, deps: RunDeps): Promise<RunResult> {
  const { brain, buy, budget, askHbar, emit } = deps;

  emit({ type: "goal", goal });

  const questions = await brain.plan(goal);
  emit({ type: "plan", questions });

  const findings: Finding[] = [];
  for (const q of questions) {
    if (!budget.canAfford(askHbar)) {
      emit({ type: "budget-exhausted", remainingHbar: budget.remaining });
      break;
    }
    const r = await buy(q);
    budget.record(r.costHbar);
    findings.push({ q, a: r.answer });
    emit({
      type: "bought",
      question: q,
      answer: r.answer,
      costHbar: r.costHbar,
      provider: r.provider,
      paymentRef: r.paymentRef,
      remainingHbar: budget.remaining,
    });
  }

  const answer = await brain.synthesize(goal, findings);
  emit({ type: "synthesis", answer });
  emit({ type: "done", spentHbar: budget.spent, findings: findings.length });

  return { answer, findings, spentHbar: budget.spent };
}
