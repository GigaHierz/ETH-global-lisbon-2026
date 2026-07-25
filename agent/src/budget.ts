// Budget enforcement for the buyer agent. The agent stops buying inference once
// cumulative spend would exceed the cap — the "budget-aware" guarantee that a
// runaway loop can never drain the wallet past AGENT_BUDGET_HBAR.

export class Budget {
  #spent = 0;
  readonly cap: number;

  constructor(capHbar: number) {
    if (!(capHbar > 0)) throw new Error(`budget cap must be positive, got ${capHbar}`);
    this.cap = capHbar;
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
        `budget exceeded: charge ${amount} ℏ > remaining ${this.remaining.toFixed(4)} ℏ (cap ${this.cap} ℏ)`,
      );
    }
    this.#spent += amount;
  }
}
