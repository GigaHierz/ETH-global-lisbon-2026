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

**The live values** (account ids and token ids are public; keys live only in your local
`.env`, gitignored):

| | |
|---|---|
| exchange / agent / verifier | `0.0.9755659` / `0.0.9755656` / `0.0.9755668` |
| provider1 / 2 / 3 / 4 | `0.0.9755663` / `0.0.9755664` / `0.0.9755665` / `0.0.9755666` |
| escrow / auditor / operator | `0.0.9755672` / `0.0.9759759` / `0.0.9700474` |
| HCS registry / trades / verdicts | `0.0.9756362` / `0.0.9756366` / `0.0.9756367` |
| USDC (settlement) | `0.0.429274` |
| ARBOND (reputation) | `0.0.9758338` |

Railway lets you share variables across services *within* a project. If you run one
service per project there is nothing to share, so **every project needs its own complete
set** — that is what is listed below. Copy each block wholesale.

Keys live in your local `.env` (gitignored). Account ids are public and safe to paste
anywhere; keys are not.

**Never set `PORT`** — Railway injects it and the code binds to it.
**Never set `HEDERA_OPERATOR_KEY`** — no runtime service reads it, and it can drain every
account. Only the local setup scripts use it.

### Start commands

The build is the repo `Dockerfile` (pinned by `railway.json`), so no build command is
needed. Every service runs the same image and differs only by its **Start Command** and
its variables:

| Service | Start Command | Domain |
|---|---|---|
| exchange | `pnpm exchange:prod` | yes |
| agent-server | `pnpm agent-server:prod` | yes |
| provider1 / 2 / 3 | `pnpm provider:prod` | yes, each |
| verifier | `pnpm verifier:prod` | no — worker |

Two traps in that table, both of which fail quietly rather than loudly:

- **The Dockerfile's default CMD is `pnpm agent-server:prod`.** Any service that does not
  set its own Start Command boots a second agent instead of what you intended.
- **`provider:prod` carries no `--profile` flag.** All three providers share one command
  and are separated purely by `PROVIDER_PROFILE`. Leave it unset and the process exits
  with "Unknown provider profile undefined".

Always use the `:prod` variants, never the bare ones (`pnpm exchange`, `pnpm provider1`,
…). The bare scripts load variables from a local file that does not exist in the
container — they are for local development only.

### exchange — start command `pnpm exchange:prod`, needs a domain

```
MOCK_MODE=false
SETTLEMENT_ASSET=usdc
HEDERA_EXCHANGE_ID=<exchange account>
HEDERA_EXCHANGE_KEY=<exchange key>
EXCHANGE_FEE_BPS=1000
REFUND_ON_FAILURE=true
HCS_REGISTRY_TOPIC=<registry topic>
HCS_TRADES_TOPIC=<trades topic>
HCS_VERDICTS_TOPIC=<verdicts topic>
HTS_BOND_TOKEN=<ARBOND token id>
```

Reads the registry topic to discover providers, publishes to trades, and serves all three
links on `/topics` — hence all three.

### agent-server — start command `pnpm agent-server:prod`, needs a domain

```
MOCK_MODE=false
SETTLEMENT_ASSET=usdc
HEDERA_AGENT_ID=<agent account>
HEDERA_AGENT_KEY=<agent key>
GROQ_API_KEY=<your groq key>
EXCHANGE_URL=https://<exchange domain>
AGENT_PUBLIC_URL=https://<agent domain>
AGENT_BUDGET=2
HCS_REGISTRY_TOPIC=<registry topic>
```

The agent publishes its own HCS-14 identity to the registry topic, so it needs that id too.

### provider1 / provider2 / provider3 — start command `pnpm provider:prod`, each needs a domain

```
MOCK_MODE=false
SETTLEMENT_ASSET=usdc
PROVIDER_PROFILE=provider1          # provider2 / provider3 on the others
PROVIDER_PUBLIC_URL=https://<THIS provider's own domain>
HEDERA_PROVIDER1_ID=<provider1 account>    # match the number to the profile
HEDERA_PROVIDER1_KEY=<provider1 key>
HEDERA_ESCROW_ID=<escrow account>
GROQ_API_KEY=<your groq key>
CHEAT_MODE=false                    # true ONLY on provider3
STAKE_HBAR=50
HCS_REGISTRY_TOPIC=<registry topic>
HTS_BOND_TOKEN=<ARBOND token id>    # so the provider can report its bond balance
```

**provider4 additionally**, since it resells 0G Compute rather than Groq:

```
PROVIDER_BACKEND=0g
ZEROG_API_KEY=<key from https://pc.0g.ai>
```

Without `ZEROG_API_KEY` a 0G-backed provider still boots and serves — it falls back to
canned responses. That is demo-safe but it is not real inference, and nothing in the logs
says so loudly.

`PROVIDER_PUBLIC_URL` must be that provider's **own** domain — it is what gets published to
HCS, so the exchange uses it to reach them. Wrong value and the provider registers, appears
in the table, and sits permanently `down`.

Match the account number to the profile: `PROVIDER_PROFILE=provider2` needs
`HEDERA_PROVIDER2_ID/KEY`. Mismatched, the provider signs as the wrong identity.

Providers need no USDC — they only ever receive. They do need HBAR for their 50 ℏ stake.

### verifier — start command `pnpm verifier:prod`, no domain (worker)

```
MOCK_MODE=false
SETTLEMENT_ASSET=usdc
HEDERA_VERIFIER_ID=<verifier account>
HEDERA_VERIFIER_KEY=<verifier key>
HEDERA_ESCROW_ID=<escrow account>
HEDERA_ESCROW_KEY=<escrow key>
HEDERA_OPERATOR_ID=<operator account id ONLY, never the key>
HEDERA_AUDITOR_ID=<auditor account>
HEDERA_AUDITOR_KEY=<auditor key>
HTS_BOND_TOKEN=<ARBOND token id>
EXCHANGE_URL=https://<exchange domain>
SLASH_HBAR=25
VERIFY_INTERVAL_MS=15000
SIMILARITY_THRESHOLD=0.35
HCS_VERDICTS_TOPIC=<verdicts topic>
```

This service holds two keys nothing else gets, for two different reasons:

- **`HEDERA_ESCROW_KEY`** — it moves staked HBAR collateral when it slashes.
- **`HEDERA_AUDITOR_KEY`** — the bond's wipe key is a 2-of-2 `[verifier, auditor]` KeyList,
  and the verifier signs *both* halves of that transaction. Without the auditor key it still
  slashes HBAR but **silently never freezes or wipes a bond** — `bondTokenId()` returns null,
  every bond call no-ops by design, and the logs look identical to "no fraud found".

The operator id is the treasury a slash pays into; the operator *key* is never needed here.

It also **needs a USDC balance**, not just an association: it pays providers for its two
audit replays. Unfunded, every replay 402s, the audit returns `inconclusive`, and no slash
ever fires — again with no error anywhere.

### dashboard (Vercel)

No environment variables. It reads the settlement symbol from the exchange's `/settlement`
endpoint and falls back to `$`.

### The ReputationBond is a second HTS token

Settlement (USDC) and reputation (ARBOND) are separate tokens with separate lifecycles.
`pnpm setup-hts` mints ARBOND and tops every provider up to `BOND_AMOUNT`; the id lands in
`deployments.json`, and `HTS_BOND_TOKEN` overrides it per environment.

Re-running `setup-hts` is safe and is how you restore a bond the verifier has wiped: it
transfers only the shortfall, so a provider already at full is left alone rather than
drifting to double and diluting what a wipe means.

Setting it nowhere is the dangerous case. `bondTokenId()` returns null, every bond
operation no-ops, and the freeze/wipe half of enforcement quietly disappears while HBAR
slashing carries on looking healthy.

### Deleting the old keys is not cosmetic

After the rename the code no longer reads `EXCHANGE_ASK_HBAR`, `AGENT_BUDGET_HBAR`,
`AGENT_MOCK_BALANCE_HBAR`, or `PROVIDER_PRICE_HBAR`. It falls back to defaults that happen
to be **the same numbers** — so a stale key looks like it is still configuring the service
while doing nothing. If you ever tuned one away from its default, that tuning silently
disappears unless you rename it.

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
