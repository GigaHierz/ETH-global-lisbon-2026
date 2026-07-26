# PROOF.md — on-chain evidence

*Step-2 gate, executed 2026-07-25. Every link below is publicly verifiable on Hedera Testnet.*

> **These receipts predate the move to USDC settlement**, so the amounts below are native
> HBAR (ℏ) — that is what actually settled at the time, and the figures are left untouched.
> Requests now settle in HTS USDC `0.0.429274`; see [MIGRATION-USDC.md](MIGRATION-USDC.md).
> Staking and slashing are still native HBAR today, so those amounts remain current.

## The two settlement transactions (slice-1 gate, run twice back-to-back)

| Round | Transaction | Hashscan |
|---|---|---|
| 1 | `0.0.7162784@1784982277.193217949` | https://hashscan.io/testnet/transaction/0.0.7162784@1784982277.193217949 |
| 2 | `0.0.7162784@1784982283.158991431` | https://hashscan.io/testnet/transaction/0.0.7162784@1784982283.158991431 |

## What each transaction proves

1. **HTTP 402 is enforced.** The unpaid request to `POST /v1/chat/completions` returned `402 Payment Required` with x402 v2 payment requirements (scheme `exact`, network `hedera:testnet`, price 10,000,000 tinybars). Only the retry carrying the signed payment succeeded.
2. **Exact-amount settlement, both sides.** Mirror-node record shows agent `0.0.9744150` at **−10,000,000 tinybars** and provider `0.0.9744152` at **+10,000,000 tinybars** — exactly the advertised 0.1 ℏ price. Asserted programmatically before/after each call via consensus-node balance queries ([scripts/smoke-paid-call.ts](../scripts/smoke-paid-call.ts)).
3. **Facilitator-sponsored fees.** The transaction fee payer is the blocky402 facilitator account `0.0.7162784` (that's why its id prefixes the transaction id). The agent's balance moved by the price and *only* the price — the payer needs zero tHBAR for gas.
4. **Reproducible.** Two consecutive rounds with identical results (`MOCK_MODE=false pnpm smoke` with provider1 running). Mirror-node REST confirms `result: SUCCESS`, type `CRYPTOTRANSFER`:
   `https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1784982277-193217949`

## Demo accounts (created + funded by `pnpm setup-hedera`)

| Role | Account | Hashscan |
|---|---|---|
| Operator / treasury | `0.0.9695453` | https://hashscan.io/testnet/account/0.0.9695453 |
| Agent (buyer) | `0.0.9744150` | https://hashscan.io/testnet/account/0.0.9744150 |
| Exchange (router) | `0.0.9744151` | https://hashscan.io/testnet/account/0.0.9744151 |
| Provider 1 — Titan Compute | `0.0.9744152` | https://hashscan.io/testnet/account/0.0.9744152 |
| Provider 2 — Budget Inference Co | `0.0.9744153` | https://hashscan.io/testnet/account/0.0.9744153 |
| Provider 3 — SketchyGPU Labs (the cheater) | `0.0.9744154` | https://hashscan.io/testnet/account/0.0.9744154 |
| Verifier | `0.0.9744156` | https://hashscan.io/testnet/account/0.0.9744156 |
| Stake escrow (verifier-held) | `0.0.9744157` | https://hashscan.io/testnet/account/0.0.9744157 |

## HCS audit trail (live — step 3 complete)

| Topic | Id | Hashscan |
|---|---|---|
| Registry (provider registrations) | `0.0.9744593` | https://hashscan.io/testnet/topic/0.0.9744593 |
| Trades (one message per paid request) | `0.0.9744594` | https://hashscan.io/testnet/topic/0.0.9744594 |
| Verdicts (verification results + slashes) | `0.0.9744595` | https://hashscan.io/testnet/topic/0.0.9744595 |

## Staking + slash (no-Solidity, live)

| Event | Transaction |
|---|---|
| Provider1 stakes 50 ℏ → escrow | https://hashscan.io/testnet/transaction/0.0.9744152@1784983507.494541568 |
| Provider2 stakes 50 ℏ → escrow | https://hashscan.io/testnet/transaction/0.0.9744153@1784983509.819605060 |
| Provider3 stakes 50 ℏ → escrow | https://hashscan.io/testnet/transaction/0.0.9744154@1784983506.692571633 |
| **SLASH: 25 ℏ escrow → treasury** (SketchyGPU caught at 10% similarity) | https://hashscan.io/testnet/transaction/0.0.9744157@1784983556.547115247 |
| Fraud verdict on HCS (verdicts topic, seq 1) | https://hashscan.io/testnet/transaction/0.0.9744156@1784983558.700345790 |

The full sting ran on-chain on 2026-07-25: the agent's calls 1–4 routed to the cheapest 70b claimant (SketchyGPU, 0.08 ℏ); the verifier replayed a sampled prompt against witness Titan Compute at temperature 0, measured 10% similarity (threshold 35%), slashed 25 ℏ from escrow, published the fraud verdict to HCS — and call 5 rerouted to honest Titan at 0.10 ℏ.

## HTS ReputationBond + 2-of-2 multi-sig wipe (SDK-native, no Solidity)

The reputation/compliance layer is additive to the proven HBAR slash above — created by
`pnpm setup-hts` and enforced by the verifier on fraud. **Executed on-chain on Hedera Testnet,
2026-07-26.** Bond token `0.0.9758338` (`deployments.json`). Keys: freezeKey = verifier;
wipeKey = 2-of-2 `KeyList` [verifier, auditor]; treasury/admin/supply/pause/feeSchedule = operator.

| Event | Hashscan |
|---|---|
| `TokenCreate` — ARBOND bond (custom fractional fee + freeze/pause/wipe keys; wipeKey = 2-of-2 KeyList) | https://hashscan.io/testnet/token/0.0.9758338 |
| Grant 100 ARBOND → provider (associate + transfer) | https://hashscan.io/testnet/transaction/0.0.9700474@1785026532.176076384 |
| Compliance control — `TokenFreeze` (verifier freezeKey) | https://hashscan.io/testnet/transaction/0.0.9755668@1785025801.133417831 |
| **2-of-2 multi-sig `TokenWipe`** — verifier + auditor co-sign, reputation → 0 (SketchyGPU) | https://hashscan.io/testnet/transaction/0.0.9755668@1785026579.941040577 |

Slash + verdict from the same run:

| Event | Hashscan |
|---|---|
| HBAR **SLASH** 25 ℏ escrow → treasury | https://hashscan.io/testnet/transaction/0.0.9755672@1785026573.137070562 |
| Fraud verdict on the HCS verdicts topic | https://hashscan.io/testnet/transaction/0.0.9755668@1785026578.428001279 |

The sting ran end-to-end: the verifier caught SketchyGPU (2% similarity), slashed 25 ℏ from
escrow → treasury, and destroyed its ARBOND bond with a **2-of-2 multi-sig `TokenWipe`** (verifier
+ auditor). Note: `TokenWipe` is **not** in Hedera's Schedule Service whitelist
(`SCHEDULED_TRANSACTION_NOT_IN_WHITELIST`), so the multi-sig is a direct two-signature
transaction, not a scheduled one — see [HEDERAFEEDBACK.md](HEDERAFEEDBACK.md).

## 0G Compute integration (provider4 / NimbusAI — 2026-07-26)

Provider4 resells compute from the 0G decentralized GPU network (0G Compute Router,
model `0gm-1.0-35b-a3b`) on the Hedera exchange. All legs on-chain:

| Event | Link |
|---|---|
| Provider4 account (created + funded) | https://hashscan.io/testnet/account/0.0.9757757 |
| Stake 50 ℏ → escrow | https://hashscan.io/testnet/transaction/0.0.9757757@1785025020.196653655 |
| HCS registration (0G model id) | https://hashscan.io/testnet/transaction/0.0.9757757@1785025020.949095076 |
| Trade: agent→exchange (0.066 ℏ = 0.06 + 0.006 fee) | https://hashscan.io/testnet/transaction/0.0.7162784@1785025050.185579079 |
| Trade: exchange→provider4 (0.06 ℏ exact) | https://hashscan.io/testnet/transaction/0.0.7162784@1785025055.187574206 |
| HCS trades message seq 35 (carries `"model":"0gm-1.0-35b-a3b"` + both txs) | https://hashscan.io/testnet/topic/0.0.9744594 |

Completion content currently uses the canned fallback pending `ZEROG_API_KEY`
(pc.0g.ai signup + 0G token deposit — human-gated); with the key in `.env`, the same
trade sources live 0G GPU output with zero code change.
