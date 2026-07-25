# FUNDING.md — Hedera Testnet money plan (USDC-default)
*Verified against both live facilitators, Mirror Node, and `@x402/hedera@2.19.0` package source. No guessed values.*

## Settlement: HTS USDC, with an HBAR fallback

| | |
|---|---|
| Asset | **USDC, `asset: "0.0.429274"`** — 6 dp (1 USDC = 10⁶ base units) |
| Prices | p1 **$0.10** · p2 **$0.04** · p3 **$0.08** · p4 **$0.06** · exchange ask **$0.12** |
| Why | Stablecoin pricing: buyers and providers quote in dollars, with no HBAR volatility between quote and settle |
| Fallback | `SETTLEMENT_ASSET=hbar` settles in native HBAR (`0.0.0`, tinybars) — no faucet, fully scriptable, used by CI |
| Bond | Staking/slashing is **always native HBAR**, in both modes — a security bond belongs in the network's own token |

Switching costs one variable and no redeploy of a different build. See
[MIGRATION-USDC.md](MIGRATION-USDC.md) for moving an existing deployment across.

## Facilitator ladder (both probed live today, both serve hedera:testnet exact/v2)

| Rung | URL | feePayer | Status |
|---|---|---|---|
| 1 | `https://api.testnet.blocky402.com` | `0.0.7162784` | ✅ live |
| 2 | `https://x402.org/facilitator` | `0.0.9185802` | ✅ live |

Boot-time: services walk the ladder, verify `/supported` contains `hedera:testnet`, log which rung answered. `FACILITATOR_URL` env overrides. Fee-payer sponsorship means **payer wallets need no tHBAR to settle** — their tHBAR is for their own txs (HCS messages, stake transfers).

## Operator status (Mirror Node, checked today)

`0.0.9695453` — **1000 tHBAR** ✅ · ECDSA · EVM alias `0x24e1…807a` matches .env

## 🛒 Human shopping list

**One faucet trip.** USDC cannot be minted from the operator, so unlike the HBAR path this
is not fully scriptable:

1. **https://faucet.circle.com** → Hedera Testnet → your operator id (~20 USDC / 2h).
2. Re-run `pnpm setup-hedera` to fan it out to the paying roles.

That manual step is the whole cost of stablecoin pricing. If you need a zero-dependency
run — CI, an offline demo, a flaky conference network — use `SETTLEMENT_ASSET=hbar` or
`MOCK_MODE=true`, both of which need no faucet at all.

Operator HBAR refill (only if below ~150 ℏ): https://portal.hedera.com — 1000 ℏ/day.

## What `pnpm setup-hedera` does (idempotent, roles in .env are skipped)

1. Creates **ECDSA accounts** with EVM aliases for every role: agent, exchange, provider1-4,
   provider (the generic custom-profile slot), verifier, **escrow**.
   - **escrow** = verifier-held stake pot (no-Solidity staking): providers transfer `STAKE_HBAR` (default 50 ℏ) there at registration; a slash is an escrow→treasury transfer (treasury = operator) plus a verdict on HCS.
2. Funds each with **100 tHBAR** for its own transactions (HCS messages, stake transfers).
3. **Associates every account with USDC `0.0.429274`.** Hedera requires an explicit
   association before an account can hold a token, and the x402 scheme pre-flights it —
   an unassociated *receiver* fails the payment with `pay_to_not_associated`. Providers
   only receive, so they need association but no balance.
4. **Distributes 6 USDC each to AGENT, EXCHANGE, and VERIFIER** once the faucet has landed.
   The verifier is easy to overlook: it pays providers directly for its audit replays, and
   an unfunded one makes every audit return `inconclusive` so **no slash ever fires**.
5. Appends ready-to-paste `HEDERA_<ROLE>_ID/KEY/EVM` lines to `.env`, prints Hashscan links.

Idempotent throughout — re-running skips existing accounts and already-associated tokens.

## Money flow at a glance

```
   portal.hedera.com ──(only if refill needed)──▶ OPERATOR 0.0.9695453 (1000 ℏ ✅, = treasury)
                                                       │  pnpm setup-hedera
        ┌──────────┬──────────┬──────────┬─────────────┼──────────┬──────────┐
        ▼          ▼          ▼          ▼             ▼          ▼          ▼
      agent    exchange  provider1  provider2     provider3   verifier    escrow
      100 ℏ     100 ℏ      100 ℏ      100 ℏ         100 ℏ       100 ℏ      100 ℏ
        │          │          └──── stake 50 ℏ each at registration ────▶ escrow
        │x402 USDC ▼                                                        │
        └────▶ exchange ──x402 USDC──▶ providers                            │ slash 25 ℏ
               (settlement fees sponsored by facilitator feePayer)          ▼
                                                                        treasury (operator)
```

## Costs sanity check

- Demo spend: 5 calls ≈ $0.60 agent-side — 6 USDC is ~50 requests per faucet trip.
- Settlement fees are facilitator-sponsored, so **payers need no HBAR to settle** — only
  to associate the token once and to pay for their own txs (HCS messages, stake transfers).
- Stakes: 50 ℏ per provider, still native HBAR and unaffected by the settlement asset.
- HCS: ~$0.0001/message equivalent. Account creation ~$0.05 eq. All noise against 100 ℏ.

## Explorer links

- Operator/treasury: https://hashscan.io/testnet/account/0.0.9695453
- Facilitator feePayers: https://hashscan.io/testnet/account/0.0.7162784 (blocky402) · https://hashscan.io/testnet/account/0.0.9185802 (x402.org)
- Demo accounts: printed by `pnpm setup-hedera` and appended to `.env`

## Reference

- Facilitator ladder pattern: https://github.com/blockydevs/wad2026-x402-workshop (HBAR-native x402 on hedera:testnet via blocky402)
- `@x402/hedera` README (package source is the ground truth for asset ids/decimals)
