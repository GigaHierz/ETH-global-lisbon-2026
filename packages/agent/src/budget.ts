// Budget enforcement for the buyer agent. The agent stops buying inference once
// cumulative spend would exceed the cap — the "budget-aware" guarantee that a
// runaway loop can never drain the wallet past AGENT_BUDGET.

import { money } from "@agentrouter/shared";

export class Budget {
  #spent = 0;
  readonly cap: number;

  constructor(cap: number) {
    if (!(cap > 0)) throw new Error(`budget cap must be positive, got ${cap}`);
    this.cap = cap;
  }

  get spent(): number {
    return this.#spent;
  }

  get remaining(): number {
    return this.cap - this.#spent;
  }

  /** True if a charge of `amount` fits within the remaining budget. */
  canAfford(amount: number): boolean {
    return amount <= this.remaining;
  }

  /** Record a spend. Throws if the amount is non-positive or would exceed the cap. */
  record(amount: number): void {
    if (!(amount > 0)) throw new Error(`charge amount must be positive, got ${amount}`);
    if (!this.canAfford(amount)) {
      throw new Error(
        `budget exceeded: charge ${money(amount)} > remaining ${money(this.remaining.toFixed(4))} (cap ${money(this.cap)})`,
      );
    }
    this.#spent += amount;
  }
}
