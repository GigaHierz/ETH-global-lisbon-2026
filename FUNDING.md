# FUNDING.md — Hedera Testnet money plan
*Verified 2026-07-25 against the live facilitator, Mirror Node, npm package source, and Circle's faucet. No guessed values.*

## What the facilitator actually supports

`GET https://x402.org/facilitator/supported` (probed live today):

```json
{ "x402Version": 2, "scheme": "exact", "network": "hedera:testnet",
  "extra": { "feePayer": "0.0.9185802" } }
```

- **Scheme:** `exact` (x402 v2) on `hedera:testnet` — same protocol we already built, different network string + signer.
- **feePayer `0.0.9185802`:** the facilitator **sponsors the settlement transaction fees**. Payer wallets do NOT need tHBAR to pay; they only sign. (Our wallets still get tHBAR for their *own* txs: ERC-8004 registration, staking deploy/slash via Hashio, HCS messages.)
- **Client/server impl:** `@x402/hedera@2.19.0` (same v2.19 line we use), on `@hiero-ledger/sdk` 2.85.0 (the renamed Hedera SDK — we standardize on this one package for HCS too, not a second `@hashgraph/sdk`).

## Settlement asset (from `@x402/hedera` package source, not docs prose)

| Asset | ID | Decimals | Amount unit |
|---|---|---|---|
| **USDC (HTS), testnet default** | **`0.0.429274`** | 6 | token smallest units |
| HBAR (native, also supported) | `0.0.0` | 8 | tinybars |

A `"$0.002"` price string resolves server-side to the network's default HTS USDC (`0.0.429274`). **HTS tokens require every receiving account to be associated with the token before it can hold them** — the setup script does this for all our accounts.

**Decision — USDC is the settlement asset.** It keeps the pitch honest ("agents buy inference with USDC") and matches the existing `"$0.002"` price plumbing unchanged. HBAR settlement (`0.0.0`) stays as a documented break-glass fallback (zero faucet dependency) if Circle's faucet dies on demo day.

## Operator status (checked on Mirror Node just now)

- `0.0.9695453` — **1000 tHBAR** ✅ (ECDSA, EVM alias `0x24e1…807a` matches .env)
- USDC associated: **not yet** (script fixes) · USDC balance: 0

## 🛒 Human shopping list (you only, everything else is scripted)

| # | What | Where | Amount | Notes |
|---|---|---|---|---|
| 1 | tHBAR | — | **nothing to do** | Operator already holds 1000 tHBAR; script distributes it. Refill only if it drops: https://portal.hedera.com (testnet, 1000 ℏ/day) |
| 2 | USDC | https://faucet.circle.com → network **Hedera Testnet** → paste **`0.0.9695453`** | **one request = 20 USDC** | Do this **after** running the setup script once (operator must be associated first — the script does that and tells you when to hit the faucet). 20 USDC ≫ demo spend (5 calls × $0.002). |

That's it. No ETH, no Base, no other faucets.

## What the script does (`scripts/setup-hedera-accounts.ts`)

Run: `pnpm setup-hedera` (idempotent — safe to re-run; skips roles already in .env)

1. Connects as operator (`HEDERA_OPERATOR_ID`/`KEY` from .env).
2. Creates 6 ECDSA accounts with EVM aliases (`AccountCreateTransaction().setECDSAKeyWithAlias(...)`): **agent, exchange, provider1, provider2, provider3, verifier**.
3. Funds each with **100 tHBAR** from the operator (600 total; ~400 stays with operator as buffer). This covers each wallet's own txs: 8004 registration, Staking deploy + slash (EVM gas via Hashio comes out of the same HBAR balance), HCS topic + messages.
4. **Associates USDC `0.0.429274`** with the operator and all 6 accounts (signed per-account, fees paid by operator).
5. If the operator holds faucet USDC: distributes **5 USDC each** to **agent** and **exchange** (the only payers: agent → exchange → providers). Otherwise prints the faucet reminder.
6. Prints ready-to-paste `.env` lines: `HEDERA_<ROLE>_ID`, `HEDERA_<ROLE>_KEY`, `HEDERA_<ROLE>_EVM` for every role, plus Hashscan account links.

## Funding flow at a glance

```
                    Circle faucet (20 USDC, one manual trip)
                                 │
                                 ▼
   portal.hedera.com ──▶ OPERATOR 0.0.9695453 (1000 tHBAR ✅)
                                 │ setup script
        ┌──────────┬─────────┬───┴──────┬──────────┬──────────┐
        ▼          ▼         ▼          ▼          ▼          ▼
      agent    exchange  provider1  provider2  provider3  verifier
     100 ℏ      100 ℏ      100 ℏ      100 ℏ      100 ℏ      100 ℏ
     +5 USDC    +5 USDC   (receives) (receives) (receives) (slashes)
        │          │
        └─ x402 ──▶└─ x402 ──▶ providers   (settlement fees: facilitator feePayer 0.0.9185802)
```

## Costs sanity check

- Demo spend: 5 calls × $0.002 = **$0.01 USDC** — 5 USDC per payer is 500× headroom, spam-flag proof.
- tHBAR: account creation ~$0.05 eq each, association ~$0.05 eq, EVM deploys a few ℏ — 100 ℏ/account is deep headroom.

## Explorer links

- Operator: https://hashscan.io/testnet/account/0.0.9695453
- USDC token: https://hashscan.io/testnet/token/0.0.429274
- Facilitator feePayer: https://hashscan.io/testnet/account/0.0.9185802

## Note on tooling

The `SearchHedera` / hedera-docs MCP named in the standing rules is **not connected in this session** (no such tool is available). Compensating by verifying every Hedera API against docs.hedera.com fetches and the published package source (as above). If you can attach that MCP, I'll use it from step 2 on.
