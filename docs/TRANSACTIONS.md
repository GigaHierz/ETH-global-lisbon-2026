# TRANSACTIONS.md — on-chain proof + how staking works

Every transaction below is a **real Hedera Testnet transaction**. Open any link on Hashscan to verify.

## How staking & slashing work — there is **no escrow contract**

This trips people up, so to be precise: **the "escrow" is a normal Hedera *account* (`0.0.9746274`), not a smart contract.** The whole stake/slash lifecycle is plain native HBAR transfers via the Hedera SDK — **no Solidity, no contract call, nothing deployed.**

- **Staking** = a provider proves skin-in-the-game by sending a native `TransferTransaction` of **50 ℏ from its own account → the escrow account**. That's it — the escrow account simply *holds* every provider's bond. (See the `+50 ℏ` transfers below.)
- **Slashing** = when the verifier catches fraud, it signs a native `TransferTransaction` of **25 ℏ from escrow → treasury** (the operator account). The escrow account's private key is held by the verifier, and that key is what authorizes the slash. (See the `−25 ℏ` transfer below.)
- **Identity, trades, and verdicts** are written to the **Hedera Consensus Service** (three topics), not a contract.

So the economic guarantees come from **native Hedera services + who holds which key**, not from on-chain contract code.

- There is **no staking contract in this repo** — the stake/slash lifecycle is entirely native HBAR transfers, so there is nothing to "verify" on Hashscan (contract verification only applies to deployed EVM contracts).
- **Trust model (honest):** because the escrow is key-held rather than contract-enforced, the verifier is trusted to slash honestly. Production hardening would move the bond into a staking contract or a multi-sig / threshold escrow — that is future work (see the security follow-up issue).

This is deliberate: it keeps the whole marketplace on **native Hedera** (HBAR transfers + HCS + the Hedera Agent Kit), which is also why the project fits the "No Solidity" approach.

## The economic loop, on-chain

```
providers ──stake 50 ℏ──▶ ESCROW account 0.0.9746274
agent ──HCS-14 identity──▶ registry topic
agent ──0.12 ℏ x402──▶ exchange ──0.10 ℏ x402──▶ cheapest provider ──▶ Groq inference
verifier catches fraud ──slash 25 ℏ──▶ treasury   +   verdict ──▶ verdicts topic
```

## 🏦 Provider stakes — 50 ℏ each into escrow (`0.0.9746274`)
| Provider | Account | Stake tx |
|---|---|---|
| provider1 (Titan) | `0.0.9746268` | [0.0.9746268-1785003833-935693730](https://hashscan.io/testnet/transaction/0.0.9746268-1785003833-935693730) |
| provider2 (Budget) | `0.0.9746270` | [0.0.9746270-1785005409-960796678](https://hashscan.io/testnet/transaction/0.0.9746270-1785005409-960796678) |
| provider3 (SketchyGPU) | `0.0.9746271` | [0.0.9746271-1785005671-130835559](https://hashscan.io/testnet/transaction/0.0.9746271-1785005671-130835559) |

## 🆔 Agent HCS-14 identity — registered via the Hedera Agent Kit (`0.0.9746264`)
`uaid:aid:hedera:testnet:0.0.9746264` submitted to the registry topic on each boot.
| Registration tx |
|---|
| [0.0.9746264-1785005379-398404018](https://hashscan.io/testnet/transaction/0.0.9746264-1785005379-398404018) |
| [0.0.9746264-1785004614-802963192](https://hashscan.io/testnet/transaction/0.0.9746264-1785004614-802963192) |

## 🤖 Agent x402 inference buys — 0.12 ℏ each (agent → exchange, real HBAR)
| Buy tx |
|---|
| [0.0.7162784-1785006207-218527924](https://hashscan.io/testnet/transaction/0.0.7162784-1785006207-218527924) |
| [0.0.7162784-1785006197-892275022](https://hashscan.io/testnet/transaction/0.0.7162784-1785006197-892275022) |
| [0.0.7162784-1785006191-378689616](https://hashscan.io/testnet/transaction/0.0.7162784-1785006191-378689616) |
| [0.0.7162784-1785004938-776438938](https://hashscan.io/testnet/transaction/0.0.7162784-1785004938-776438938) |
| [0.0.7162784-1784995807-392888972](https://hashscan.io/testnet/transaction/0.0.7162784-1784995807-392888972) |

> x402 settlements are submitted by the facilitator's fee-payer (`0.0.7162784`, which sponsors the network fee) and move the HBAR from the agent to the exchange — open a tx and read the transfer list.

## ⚡ The slash — verifier cut the cheater's stake on-chain (escrow → treasury, −25 ℏ)
| Event | Slash tx |
|---|---|
| SketchyGPU Labs slashed for model fraud | [0.0.9746274-1785006878-335286651](https://hashscan.io/testnet/transaction/0.0.9746274-1785006878-335286651) |

## 📜 HCS audit trail (full history, streamed from Mirror Node)
| Topic | Purpose | Link |
|---|---|---|
| `0.0.9744593` | registry — agent/provider identities | [topic](https://hashscan.io/testnet/topic/0.0.9744593) |
| `0.0.9744594` | trades — every routed buy | [topic](https://hashscan.io/testnet/topic/0.0.9744594) |
| `0.0.9744595` | verdicts — verifier fraud/slash rulings | [topic](https://hashscan.io/testnet/topic/0.0.9744595) |

## 👛 Account ledgers (live balances)
| Role | Account |
|---|---|
| AGENT (buyer) | [0.0.9746264](https://hashscan.io/testnet/account/0.0.9746264) |
| EXCHANGE | [0.0.9746267](https://hashscan.io/testnet/account/0.0.9746267) |
| ESCROW (bonds) | [0.0.9746274](https://hashscan.io/testnet/account/0.0.9746274) |

---

**In one line:** providers post a 50 ℏ bond to an escrow *account*, the agent registers an HCS-14 identity and pays 0.12 ℏ per inference over x402, and the verifier slashes 25 ℏ from a fraudulent provider — all as **native Hedera transactions, no smart contract deployed.**
