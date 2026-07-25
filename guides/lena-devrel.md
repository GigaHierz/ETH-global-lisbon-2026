# Lena — DEVREL: payments, Hedera services, submission

*You don't need to read the codebase. This page is everything, with receipts.*

## How a payment settles (the 30-second explanation)

1. Buyer hits a paid endpoint → **HTTP 402** with machine-readable price: `10,000,000 tinybars (0.1 ℏ), pay to 0.0.9744152, network hedera:testnet`.
2. Buyer's x402 client signs a Hedera transfer for exactly that and retries with an `X-PAYMENT` header.
3. The **facilitator** verifies and submits it — and **pays the network fee itself** (feePayer sponsorship). The buyer needs zero gas; their balance moves by the price and only the price.
4. Server streams back the inference + the settlement tx id. Whole loop ≈ 2 seconds.

**Facilitator ladder** (boot-verified, logged): ① `api.testnet.blocky402.com` (feePayer `0.0.7162784`) → ② `x402.org/facilitator` (feePayer `0.0.9185802`) → ③ self-host stub (`SELF_HOST_FACILITATOR=true`, TODO). If one dies, services boot on the next rung; if all die, `MOCK_MODE=true` keeps the full demo alive offline.

## HCS topic map (the audit trail — live)

| Topic | Carries | Who writes |
|---|---|---|
| **registry** | provider registration JSON: HCS-14 agent id, model, price, endpoint, `hcs14` profile block | providers, on boot |
| **trades** | one JSON message per paid request: provider, price, latency, payment tx | exchange |
| **verdicts** | verification results + slashes: similarity score, threshold, slash tx | verifier |

Topic ids + Hashscan links are live in [PROOF.md](../PROOF.md) §HCS (registry 0.0.9744593 · trades 0.0.9744594 · verdicts 0.0.9744595). Anyone can replay the whole market from public Mirror Node data — that's the pitch line.

## Hedera bounty checklist → where it's satisfied

| Requirement | Where |
|---|---|
| x402 payments on hedera:testnet | [provider/src/index.ts](../provider/src/index.ts) (paywall, `ExactHederaScheme`), [exchange/src/payer.ts](../exchange/src/payer.ts) (payer) — proven in [PROOF.md](../PROOF.md) |
| Native services, no Solidity | **HCS** topics (identity/trades/verdicts) + **Mirror Node** REST (discovery, dashboard audit panel); staking = native HBAR escrow transfers; `contracts/` kept but **not deployed** ([README](../README.md) §Not in this MVP) |
| Consensus Service usage | provider registration + trade log + verdicts ([shared/src/hcs.ts](../shared/src/hcs.ts), live — messages on all three topics) |
| Mirror Node usage | exchange discovery + dashboard audit trail (live) |
| Testnet accounts + funding story | [FUNDING.md](../FUNDING.md), [scripts/setup-hedera-accounts.ts](../scripts/setup-hedera-accounts.ts) |
| Fee-sponsored UX | facilitator feePayer — buyer pays zero gas ([PROOF.md](../PROOF.md) point 3) |

## Submission requirements

- [ ] **Public repo** — before making it public, sanity: `.env` is gitignored and never committed (verified: `git log --all -- .env` is empty); operator key exists only in `.env`
- [ ] **README payment-flow section** — [README](../README.md) §Real payments (architecture diagram included); expanded in playbook step 7
- [ ] **Video ≤ 5 min** — suggested cut: 0:00 problem (30s) → 0:30 live demo `pnpm demo` + dashboard (2:30) → 3:00 Hashscan receipts from PROOF.md (60s) → 4:00 architecture + what's next (60s)
- [ ] **Working demo** — `pnpm demo` (mock, bulletproof) or `MOCK_MODE=false` (real chain, proven)

## Links to cite (all public, all live)

- Settlements: the two tx links in [PROOF.md](../PROOF.md)
- Accounts: PROOF.md table (operator, agent, exchange, 3 providers, verifier, escrow)
- Facilitators: https://hashscan.io/testnet/account/0.0.7162784 · https://hashscan.io/testnet/account/0.0.9185802
- Reference pattern: https://github.com/blockydevs/wad2026-x402-workshop

## Q&A crib (updated for Hedera — supersedes the old brief's Base answers)

- *"Is the money real?"* Testnet HBAR, real x402 v2 protocol, real facilitator settlement — mainnet is a network-string change.
- *"Why Hedera?"* Fee-sponsored payments (agents need zero gas), sub-3s finality on the paid call round-trip, and HCS gives an ordered, public, replayable audit log without deploying a single contract.
- *"Why did prices go UP after the slash?"* The cheater's 0.08 ℏ price was fraudulent (8b sold as 70b). Repricing to the honest 0.10 ℏ is the market telling the truth. Verification makes prices honest, not low.
- *"What stops the verifier lying?"* MVP trusts it (escrow is verifier-held). Production: verifier sets with their own stakes and disputes — future work, we say so.
