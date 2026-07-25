# Migrating settlement from HBAR to USDC

Per-request payments now settle in **HTS USDC (`0.0.429274`, 6 dp)** instead of native
HBAR. This is the runbook for moving an existing deployment across.

It is a **clean cutover, not a rolling upgrade**: field names changed on the wire, so
every service has to move together. Do the whole list in order, then redeploy everything.

**The quality bond did not move.** Staking and slashing (`STAKE_HBAR`, `SLASH_HBAR`) stay
in native HBAR — a security bond belongs in the network's own token, and Hedera fees are
HBAR regardless. Only per-request settlement is USDC.

**Rollback is one variable.** Set `SETTLEMENT_ASSET=hbar` everywhere and redeploy the same
build. No code change, no re-migration.

---

## What changed, in one table

| | Before | After |
|---|---|---|
| Settlement asset | native HBAR (`0.0.0`, tinybar) | HTS USDC `0.0.429274`, 6 dp |
| Selected by | nothing — hardcoded | `SETTLEMENT_ASSET` (`usdc` default, `hbar` fallback) |
| Price fields | `priceHbar`, `costHbar`, `pricePaidHbar`, … | `price`, `cost`, `total`, … |
| Fee math | `tinybarsOf` / `hbarOf` (fixed 10⁻⁸) | `baseUnitsOf` / `fromBaseUnits` (asset's own decimals) |
| Stake / slash | `stakeHbar`, `amountHbar` in HBAR | **unchanged** |
| Prerequisite | operator HBAR only | operator HBAR **+ a Circle faucet trip** |

The faucet is the one real cost of this change: USDC cannot be minted from the operator,
so `pnpm setup-hedera` can no longer take you from zero to funded in a single command.
`SETTLEMENT_ASSET=hbar` and `MOCK_MODE=true` remain the zero-faucet paths.

---

## Step 1 — accounts, association, funding

```bash
pnpm setup-hedera
```

Creates any missing role accounts, then **associates every account with USDC**. Hedera
requires an explicit association before an account can hold a token, and the x402 Hedera
scheme pre-flights this against Mirror Node — an unassociated *receiver* fails the payment
with `pay_to_not_associated` before anything hits the chain. Providers only ever receive,
so they need association but no balance.

The script is idempotent: re-running skips existing accounts and already-associated tokens.

> Expect it to create an **8th/9th account** the first time. `ROLES` covers `PROVIDER4` and
> the generic `PROVIDER` (custom-profile) slot, which older `.env` files predate. That is
> intended, not a bug.

Then get testnet USDC — this step is manual and cannot be scripted:

**https://faucet.circle.com** → Hedera Testnet → your `HEDERA_OPERATOR_ID` (~20 USDC/2h)

```bash
pnpm setup-hedera        # re-run: fans USDC out to the paying roles
```

Funding goes to **AGENT, EXCHANGE, and VERIFIER** (6 USDC each, 18 of the ~20 cap).

> **The verifier is a payer.** It looks like a passive observer, but it pays providers
> directly for its two audit replays. An unfunded verifier means every replay 402s, the
> audit returns `inconclusive`, and **no slash ever fires** — the demo's centerpiece
> silently stops working with no error anywhere. If you fund accounts by hand, do not skip it.

Mirror Node lags the consensus node by a few seconds, so if distribution reports a short
balance immediately after the faucet, just re-run.

## Step 2 — fresh HCS topics

```bash
pnpm setup-hcs
```

HCS messages are immutable, so the existing topics hold HBAR-denominated registrations
under the old `priceHbar` field name. Minting a clean set avoids mixing units in one
audit trail. Copy the three ids into `deployments.json` (or set them as env vars — see
below). Providers re-register automatically on next boot.

New registrations carry an explicit `asset` field so an archived message can always say
what its price was denominated in.

## Interaction with the exchange taker fee

The percentage fee (`EXCHANGE_FEE_BPS`, default 1000 = 10%) is computed in **integer base
units of the active settlement asset** — micro-USDC at 6 dp, tinybar at 8 dp — and always
rounds up, so the exchange never underquotes in either mode. The arithmetic itself is
scale-agnostic; only the conversions at the edges know which asset is active.

Two consequences worth knowing:

- A refund moves the **same asset the payment did**. Refunding HBAR for a USDC payment
  would return the wrong token at the wrong scale, so `sendRefund` branches on
  `SETTLEMENT_ASSET` exactly like the payment path.
- `EXCHANGE_FEE_BPS` needs no change when you switch assets — basis points are a ratio.

## Step 3 — per-service variables

Set on **every** Railway service:

| Action | Variable | Value |
|---|---|---|
| **ADD** | `SETTLEMENT_ASSET` | `usdc` |
| ADD *(recommended)* | `HCS_REGISTRY_TOPIC`, `HCS_TRADES_TOPIC`, `HCS_VERDICTS_TOPIC` | ids from step 2 |

The topic ids fall back to `deployments.json`, which is resolved relative to the process
working directory — not something a container image guarantees. Setting them explicitly
removes that dependency.

Then per service:

| Service | Add | Rename | Remove | Unchanged |
|---|---|---|---|---|
| **exchange** | `SETTLEMENT_ASSET=usdc` | `EXCHANGE_ASK_HBAR=0.12` → `EXCHANGE_ASK=0.12` | `EXCHANGE_ASK_HBAR` | `HEDERA_EXCHANGE_ID`, `HEDERA_EXCHANGE_KEY` |
| **agent-server** | `SETTLEMENT_ASSET=usdc` | `AGENT_BUDGET_HBAR=2` → `AGENT_BUDGET=2` | `AGENT_BUDGET_HBAR`, `AGENT_MOCK_BALANCE_HBAR` | `HEDERA_AGENT_ID/KEY`, `GROQ_API_KEY`, `EXCHANGE_URL` |
| **provider1/2/3** *(+4)* | `SETTLEMENT_ASSET=usdc` | — | — | `PROVIDER_PROFILE`, `PROVIDER_PUBLIC_URL`, `HEDERA_PROVIDER<N>_ID/KEY`, `HEDERA_ESCROW_ID`, `GROQ_API_KEY`, `CHEAT_MODE`, **`STAKE_HBAR`** |
| **custom provider** | `SETTLEMENT_ASSET=usdc` | `PROVIDER_PRICE_HBAR` → `PROVIDER_PRICE` | `PROVIDER_PRICE_HBAR` | `PROVIDER_NAME`, `PROVIDER_MODEL`, `HEDERA_PROVIDER_ID/KEY` |
| **verifier** | `SETTLEMENT_ASSET=usdc` | — | — | `HEDERA_VERIFIER_ID/KEY`, `HEDERA_ESCROW_ID/KEY`, `HEDERA_OPERATOR_ID`, `EXCHANGE_URL`, **`SLASH_HBAR`** |
| **dashboard** (Vercel) | — | — | — | no variables required |

### Deleting the old keys is not cosmetic

After the rename the code no longer reads `EXCHANGE_ASK_HBAR`, `AGENT_BUDGET_HBAR`,
`AGENT_MOCK_BALANCE_HBAR`, or `PROVIDER_PRICE_HBAR`. It falls back to defaults that happen
to be **the same numbers** — so a stale key looks like it is still configuring the service
while doing nothing. If you have ever tuned one of these away from its default, that tuning
silently disappears unless you rename it.

### While you are in the Vercel settings

Root Directory should be `packages/dashboard` (it was `dashboard` before the monorepo
reorganisation). The dashboard needs no environment variables — it reads the settlement
symbol from the exchange's `/settlement` endpoint and falls back to `$`.

## Step 4 — verify

```bash
pnpm test:coverage                                  # unit + coverage gate
pnpm --filter @agentrouter/dashboard build          # all 7 routes
MOCK_MODE=true pnpm demo                            # full story, no funding needed
```

The mock demo proves the renames and the UI, but **not settlement** — `MOCK_MODE`
short-circuits before the x402 branch, so it never executes the pricing code. For that:

```bash
MOCK_MODE=false pnpm tsx scripts/smoke-paid-call.ts
```

It asserts two things separately: the USDC balances moved by exactly the price, **and** the
agent's HBAR balance did not move (settlement fees are facilitator-sponsored). A fee leak
and a price mismatch are different failures and should not be reported as one.

Confirm the HashScan link shows an **HTS `0.0.429274` transfer**, not an HBAR transfer.

Then re-run with `SETTLEMENT_ASSET=hbar` to confirm the fallback still settles in HBAR —
that is the CI path and it must not regress.

Finally, exercise the slash path in real mode (the only check that catches an unfunded
verifier), and confirm the live dashboard renders `$` and `¢/REQ` with non-zero prices.

### Failures worth recognising

| Symptom | Cause |
|---|---|
| `pay_to_not_associated` | a receiving account was missed in step 1 |
| `insufficient_balance` | faucet hasn't landed yet, or a payer was skipped — re-run and retry |
| audits always `inconclusive`, no slash | **verifier has no USDC** |
| provider shows price `0.00` / never routed to | it is serving an old `/info` — redeploy it |
