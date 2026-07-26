# TRANSACTIONS.md — on-chain proof + how staking works

Every transaction below is a **real Hedera Testnet transaction** from the current account
set. Open any link on Hashscan to verify.

Three assets, three jobs: settlement runs on **HTS USDC** (`0.0.429274`, 6 dp), collateral
and slashing stay in **native HBAR**, and reputation is the **ARBOND** HTS token
(`0.0.9758338`).

## How staking & slashing work — there is **no escrow contract**

This trips people up, so to be precise: **the "escrow" is a normal Hedera *account*
(`0.0.9755672`), not a smart contract.** The whole stake/slash lifecycle is plain native
HBAR transfers via the Hedera SDK — **no Solidity, no contract call, nothing deployed.**

- **Staking** = a provider sends a native `TransferTransaction` of **50 ℏ from its own
  account → the escrow account**. The escrow account simply *holds* every provider's bond.
- **Slashing** = the verifier signs a native `TransferTransaction` of **25 ℏ from escrow →
  treasury** (the operator). The escrow's private key is held by the verifier, and that key
  is what authorizes the slash.
- **Identity, trades, and verdicts** go to the **Hedera Consensus Service** (three topics).
- **Reputation** is an HTS token whose freeze/wipe keys encode who may punish whom.

So the economic guarantees come from **native Hedera services + who holds which key**, not
from contract code.

- **Trust model (honest):** because escrow is key-held rather than contract-enforced, the
  verifier is trusted to slash honestly. The ARBOND wipe is deliberately *not* unilateral —
  it needs a 2-of-2 signature — but the HBAR slash still is. Production hardening would move
  the bond into a threshold escrow; that is future work.

## The economic loop, on-chain

```
agent ──USDC price+fee──▶ exchange ──USDC price──▶ provider     (x402 `exact`, HTS)
   │                                                   │
   │                                          stake 50 ℏ│ at registration
   ▼                                                   ▼
HCS registry / trades / verdicts                 escrow 0.0.9755672
                                                        │ slash 25 ℏ
                                                        ▼
                                                  treasury (operator)
```

Settlement fees are paid by the facilitator, so **payers spend no HBAR to settle** — an
agent needs USDC and nothing else. Providers need HBAR only for their own transactions
(the stake, HCS messages).

---

## 💵 x402 settlement in USDC — two legs per request

Each paid request settles twice: the agent pays the exchange `price + fee`, and the exchange
pays the provider exactly its listed `price`. Both are HTS transfers of `0.0.429274`.

| Leg | Transaction |
|---|---|
| agent → exchange ($0.066) | [`0.0.7162784@1785031775.190216635`](https://hashscan.io/testnet/transaction/0.0.7162784@1785031775.190216635) |
| exchange → provider ($0.06) | [`0.0.7162784@1785031775.440932088`](https://hashscan.io/testnet/transaction/0.0.7162784@1785031775.440932088) |

That pair is the **0G trade** — NimbusAI reselling 0G Compute on `0gm-1.0-35b-a3b`. The
transaction id belongs to the facilitator (`0.0.7162784`) because it is the fee payer; the
agent's own HBAR balance is untouched across the entire flow.

These two legs are what the dashboard's live settlement feed exposes per row in its `TX in·out`
column: **↙** links leg 1 (agent → exchange, money in) and **↗** links leg 2 (exchange → provider,
money out), each opening the transaction on HashScan. Refunded rows add a third **↩** icon for the
return transfer. (Dashboard reference: [`FRONTEND.md`](./FRONTEND.md#settlement-feed--the-tx-inout-column).)

Measured deltas from a six-request run:

| Account | Δ | Why |
|---|---|---|
| agent | **−$0.506** | 3 × $0.11 + 2 × $0.088 + 1 × $0.066 |
| provider1 | **+$0.30** | 3 × $0.10, its full ask |
| provider3 | **+$0.16** | 2 × $0.08 |
| provider4 | **+$0.06** | 1 × $0.06 (the 0G model) |
| exchange | **+$0.046** | the 10% taker fee, and only that |
| agent HBAR | **0.00** | facilitator-sponsored |

The exchange's own books agree independently:
`{"totalVolume":0.52,"requests":6,"feeRevenue":0.052,"asset":"USDC"}`.

## 🏦 Provider stake — 50 ℏ into escrow (`0.0.9755672`)

| Event | Transaction |
|---|---|
| provider1 stake | [`0.0.9755663@1785032009.643710227`](https://hashscan.io/testnet/transaction/0.0.9755663@1785032009.643710227) |

Staking is idempotent across restarts: a provider asks the HCS registry topic whether this
account already registered, rather than trusting a local cache file. Before that fix every
container restart re-staked 50 ℏ, and two providers were drained to under 1 ℏ that way —
silently, because a provider with no HBAR still receives USDC perfectly well.

## ⚡ The full fraud arc — caught, slashed, bond destroyed

provider3 advertises `llama-3.3-70b-versatile` and serves the small model. The verifier
replays a sampled prompt against an honest witness at temperature 0, measures similarity,
and enforces on-chain when it diverges.

| Step | Transaction |
|---|---|
| HBAR slash — escrow → treasury, −25 ℏ | [`0.0.9755672@1785032858.585190296`](https://hashscan.io/testnet/transaction/0.0.9755672@1785032858.585190296) |
| Verdict published to HCS | [`0.0.9755668@1785032855.889427564`](https://hashscan.io/testnet/transaction/0.0.9755668@1785032855.889427564) |
| **2-of-2 multi-sig bond wipe** | [`0.0.9755668@1785032863.182227032`](https://hashscan.io/testnet/transaction/0.0.9755668@1785032863.182227032) |
| Bond frozen (containment) | [`0.0.9755668@1785032864.733485641`](https://hashscan.io/testnet/transaction/0.0.9755668@1785032864.733485641) |

Confirmed on Mirror Node afterwards:

```
provider3   ARBOND 100 → 0     freeze_status FROZEN
provider1   ARBOND 100         UNFROZEN      ← honest, untouched
provider4   ARBOND 100         UNFROZEN
escrow      413 → 337.99 ℏ     two slashes of 25 ℏ
```

### Order matters, and not the way you would guess

The design was *freeze then wipe*: contain first, destroy second. Hedera rejects that —
`TokenWipe` against a frozen balance fails with `ACCOUNT_FROZEN_FOR_TOKEN`. Freezing first
blocks the very wipe it was meant to protect.

So enforcement **destroys first and contains second**. The freeze still earns its keep:
afterwards the account cannot receive a replacement bond. If a bond is already frozen from
an earlier pass, the verifier lifts the freeze, wipes, and re-freezes.

The wipe key is a 2-of-2 `KeyList[verifier, auditor]`, so destroying reputation genuinely
requires two parties. The freeze key is the verifier alone — containment is unilateral,
destruction is not.

## 🪙 The ReputationBond token (`0.0.9758338`)

| Property | Value |
|---|---|
| Symbol | ARBOND, 0 decimals |
| Custom fee | 2% fractional → treasury |
| Freeze key | verifier (single signer) |
| Wipe key | **KeyList 2-of-2** [verifier, auditor] |
| Grant | 100 ARBOND per provider |

`pnpm setup-hts` tops providers up to `BOND_AMOUNT` rather than re-granting, so a wiped bond
can be restored without inflating healthy ones — and it reconciles the freeze/wipe keys
against the accounts currently configured. A token minted before the auditor account existed
carries a stale wipe key, and every wipe then fails with `INVALID_SIGNATURE`, which reads
like a signing bug rather than configuration drift.

## 📜 HCS audit trail

| Topic | Id |
|---|---|
| registry | [`0.0.9756362`](https://hashscan.io/testnet/topic/0.0.9756362) |
| trades | [`0.0.9756366`](https://hashscan.io/testnet/topic/0.0.9756366) |
| verdicts | [`0.0.9756367`](https://hashscan.io/testnet/topic/0.0.9756367) |

Registrations and trades carry an explicit `asset` field. HCS messages are immutable, so the
unit has to travel with the amount — otherwise an archived trade cannot say whether `0.08`
meant dollars or HBAR.

## 👛 Accounts

| Role | Account |
|---|---|
| agent | [`0.0.9755656`](https://hashscan.io/testnet/account/0.0.9755656) |
| exchange | [`0.0.9755659`](https://hashscan.io/testnet/account/0.0.9755659) |
| provider1 · Titan (Groq, honest 70b) | [`0.0.9755663`](https://hashscan.io/testnet/account/0.0.9755663) |
| provider2 · Budget (Groq, honest 8b) | [`0.0.9755664`](https://hashscan.io/testnet/account/0.0.9755664) |
| provider3 · SketchyGPU (**the cheater**) | [`0.0.9755665`](https://hashscan.io/testnet/account/0.0.9755665) |
| provider4 · NimbusAI (**0G Compute**) | [`0.0.9755666`](https://hashscan.io/testnet/account/0.0.9755666) |
| verifier | [`0.0.9755668`](https://hashscan.io/testnet/account/0.0.9755668) |
| auditor (2nd wipe signer) | [`0.0.9759759`](https://hashscan.io/testnet/account/0.0.9759759) |
| escrow (stake pot) | [`0.0.9755672`](https://hashscan.io/testnet/account/0.0.9755672) |
| operator / treasury | [`0.0.9700474`](https://hashscan.io/testnet/account/0.0.9700474) |
