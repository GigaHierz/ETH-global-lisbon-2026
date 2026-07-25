# PROOF.md — on-chain evidence

*Step-2 gate, executed 2026-07-25. Every link below is publicly verifiable on Hedera Testnet.*

## The two settlement transactions (slice-1 gate, run twice back-to-back)

| Round | Transaction | Hashscan |
|---|---|---|
| 1 | `0.0.7162784@1784982277.193217949` | https://hashscan.io/testnet/transaction/0.0.7162784@1784982277.193217949 |
| 2 | `0.0.7162784@1784982283.158991431` | https://hashscan.io/testnet/transaction/0.0.7162784@1784982283.158991431 |

## What each transaction proves

1. **HTTP 402 is enforced.** The unpaid request to `POST /v1/chat/completions` returned `402 Payment Required` with x402 v2 payment requirements (scheme `exact`, network `hedera:testnet`, price 10,000,000 tinybars). Only the retry carrying the signed payment succeeded.
2. **Exact-amount settlement, both sides.** Mirror-node record shows agent `0.0.9744150` at **−10,000,000 tinybars** and provider `0.0.9744152` at **+10,000,000 tinybars** — exactly the advertised 0.1 ℏ price. Asserted programmatically before/after each call via consensus-node balance queries ([scripts/smoke-paid-call.ts](scripts/smoke-paid-call.ts)).
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

## HCS audit trail (step 3 — placeholder, filled when topics go live)

| Topic | Id | Hashscan |
|---|---|---|
| Registry (provider registrations) | _pending_ | _pending_ |
| Trades (one message per paid request) | _pending_ | _pending_ |
| Verdicts (verification results + slashes) | _pending_ | _pending_ |

Stake transfers (50 ℏ per provider → escrow `0.0.9744157`) and the slash transfer (escrow → treasury) will also appear here once step 4 lands.
