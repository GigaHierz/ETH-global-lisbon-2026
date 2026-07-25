# FUNDING.md — Hedera Testnet money plan (HBAR-default)
*Verified 2026-07-25 against both live facilitators, Mirror Node, and `@x402/hedera@2.19.0` package source. No guessed values. Supersedes the earlier USDC-default version per team playbook.*

## Settlement: native HBAR (locked decision)

| | |
|---|---|
| Asset | **HBAR, `asset: "0.0.0"`** — amounts in **tinybars** (1 ℏ = 10⁸ tb) |
| Prices | p1 **0.10 ℏ** = 10,000,000 tb · p2 **0.04 ℏ** = 4,000,000 tb · p3 **0.08 ℏ** = 8,000,000 tb |
| Why | Zero faucet dependency on the critical path — operator's 1000 tHBAR funds everything, fully scripted |
| USDC path | Stays functional behind `SETTLEMENT_ASSET=usdc` (HTS token `0.0.429274`, 6 dp). Associations remain in the setup script so the switch is flip-only. Circle faucet (20 USDC/2h → operator id) is only needed if you flip. |

## Facilitator ladder (both probed live today, both serve hedera:testnet exact/v2)

| Rung | URL | feePayer | Status |
|---|---|---|---|
| 1 | `https://api.testnet.blocky402.com` | `0.0.7162784` | ✅ live |
| 2 | `https://x402.org/facilitator` | `0.0.9185802` | ✅ live |
| 3 | self-host stub via `@x402/hedera/exact/facilitator` behind `SELF_HOST_FACILITATOR=true` | our operator | fallback |

Boot-time: services walk the ladder, verify `/supported` contains `hedera:testnet`, log which rung answered. `FACILITATOR_URL` env overrides. Fee-payer sponsorship means **payer wallets need no tHBAR to settle** — their tHBAR is for their own txs (HCS messages, stake transfers).

## Operator status (Mirror Node, checked today)

`0.0.9695453` — **1000 tHBAR** ✅ · ECDSA · EVM alias `0x24e1…807a` matches .env

## 🛒 Human shopping list

**Nothing.** HBAR-default removes every manual step: no Circle faucet, no ETH, no Base. Operator refill (only if balance drops below ~150 ℏ): https://portal.hedera.com — testnet, 1000 ℏ/day.

## What `pnpm setup-hedera` does (idempotent, roles in .env are skipped)

1. Creates **7 ECDSA accounts** with EVM aliases: agent, exchange, provider1-3, verifier, **escrow**.
   - **escrow** = verifier-held stake pot (no-Solidity staking): providers transfer `STAKE_HBAR` (default 50 ℏ) there at registration; a slash is an escrow→treasury transfer (treasury = operator) plus a verdict on HCS.
2. Funds each with **100 tHBAR** (700 total, ~300 stays with operator as buffer).
3. Associates USDC `0.0.429274` with operator + all accounts (keeps the USDC switch flip-only; costs pennies).
4. Appends ready-to-paste `HEDERA_<ROLE>_ID/KEY/EVM` lines to `.env`, prints Hashscan links.

## Money flow at a glance

```
   portal.hedera.com ──(only if refill needed)──▶ OPERATOR 0.0.9695453 (1000 ℏ ✅, = treasury)
                                                       │  pnpm setup-hedera
        ┌──────────┬──────────┬──────────┬─────────────┼──────────┬──────────┐
        ▼          ▼          ▼          ▼             ▼          ▼          ▼
      agent    exchange  provider1  provider2     provider3   verifier    escrow
      100 ℏ     100 ℏ      100 ℏ      100 ℏ         100 ℏ       100 ℏ      100 ℏ
        │          │          └──── stake 50 ℏ each at registration ────▶ escrow
        │x402 HBAR ▼                                                        │
        └────▶ exchange ──x402 HBAR──▶ providers                            │ slash 25 ℏ
               (settlement fees sponsored by facilitator feePayer)          ▼
                                                                        treasury (operator)
```

## Costs sanity check

- Demo spend: 5 calls ≈ 0.4 ℏ agent-side — 100 ℏ is 250× headroom, `--spam`-proof.
- Stakes: 3 × 50 ℏ out of provider balances (they keep 50 ℏ working capital each).
- HCS: ~$0.0001/message equivalent. Account creation ~$0.05 eq. All noise against 100 ℏ.

## Explorer links

- Operator/treasury: https://hashscan.io/testnet/account/0.0.9695453
- Facilitator feePayers: https://hashscan.io/testnet/account/0.0.7162784 (blocky402) · https://hashscan.io/testnet/account/0.0.9185802 (x402.org)
- USDC token (optional path): https://hashscan.io/testnet/token/0.0.429274
- Demo accounts: printed by `pnpm setup-hedera` and appended to `.env`

## Reference

- Facilitator ladder pattern: https://github.com/blockydevs/wad2026-x402-workshop (HBAR-native x402 on hedera:testnet via blocky402)
- `@x402/hedera` README (package source is the ground truth for asset ids/decimals)
