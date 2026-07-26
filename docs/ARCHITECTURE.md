# ARCHITECTURE.md — the agents, how they work, and the Hedera stack

AgentRouter is a **spot market for LLM inference** and a showcase of **agentic payments**: AI
agents buy inference per request, pay in **real HBAR over x402** (sub-second finality, low
predictable fees), providers stake HBAR + hold an **HTS ReputationBond**, and a verifier slashes
fraud and **destroys the bond with a 2-of-2 multi-sig wipe** — all on **Hedera Testnet**,
SDK-native across **HCS + HTS + Mirror Node**, **no smart contract**.

## 1. What the agents do

There are three kinds of autonomous actors, each with its own Hedera account + HCS-14-style identity:

### The buyer agent (`packages/agent/`)
An autonomous agent with its own wallet that **accomplishes a goal by buying inference**:
- Registers an **HCS-14-style identity** (`uaid:aid:hedera:testnet:0.0.9746264`) on-chain **via the Hedera Agent Kit**.
- Given a goal, **plans** sub-questions, **buys** an answer to each through the exchange (paying
  real USDC via x402 from its own account), and **synthesizes** a result.
- **Budget-aware**: it stops the moment the next purchase would exceed `AGENT_BUDGET`.

### The provider agents (`packages/provider/`, supply side)
One codebase, four "personalities" (Titan, Budget, NimbusAI, SketchyGPU):
- Register an HCS-14-style identity + advertised model/price to the registry topic.
- **Stake 50 ℏ** to an escrow account as a quality bond, and hold an **HTS ReputationBond** (`ARBOND`) whose balance is their on-chain reputation.
- Serve inference (proxying Groq) behind an x402 paywall.
- One of them (**SketchyGPU**) is a **cheater**: it advertises a 70B model but secretly serves 8B.

### The verifier agent (`packages/verifier/`)
An autonomous auditor:
- Samples routed requests from the exchange log, **replays** a prompt (temperature 0) against the
  accused provider **and an honest witness** on the same model.
- Measures answer divergence (unicode-safe bigram-Jaccard); below threshold ⇒ **fraud**.
- **Slashes** the cheater's HBAR stake on-chain (escrow → treasury) and **destroys its HTS bond with a 2-of-2 multi-sig `TokenWipe`** (verifier + auditor) — then publishes the verdict to HCS.

*(The `packages/exchange/` is the marketplace hub — routing + x402 paywall — not an autonomous agent.)*

## 2. How they work — the flow

```
provider ──stake 50 ℏ──▶ escrow account          provider ──register──▶ HCS registry topic
agent ──register HCS-14──▶ registry topic
agent goal ─▶ plan (Groq) ─▶ for each question:
    agent ──$0.12 x402──▶ exchange ──routes to cheapest──▶ provider ──▶ Groq completion
    (exchange keeps the spread; every buy logged to the trades topic)
verifier ─▶ sample log ─▶ replay accused vs witness ─▶ divergent?
    ─▶ slash 25 ℏ (escrow→treasury) + 2-of-2 multi-sig wipe of ARBOND bond + verdict to HCS
```

- **Payments** are x402: an HTTP 402 challenge → the payer signs an HBAR transfer → a facilitator
  settles it on Hedera (fee-sponsored) → the request proceeds.
- **Identity + audit** are HCS: agents/providers register to the *registry* topic; trades and
  verdicts stream to their own topics — a tamper-evident, Mirror-Node-readable trail.
- **Staking/slashing** is native: an HBAR transfer into an escrow *account*, and a transfer out
  signed by the escrow key the verifier holds. No contract (see `TRANSACTIONS.md`).
- **Reputation + enforcement** is HTS: an `ARBOND` bond token with custom-fee + freeze/pause/wipe
  controls; on fraud the verifier destroys it with a **2-of-2 multi-sig `TokenWipe`** — two
  independent signatures (verifier + auditor) on one transaction, no keeper.

## 3. What we use from the Hedera SDK & tooling

| Piece | Where / how we use it |
|---|---|
| **Hedera SDK** (`@hiero-ledger/sdk`) | `TransferTransaction` (x402 HBAR payments, 50 ℏ stakes, 25 ℏ slash), `TopicMessageSubmitTransaction` / `TopicCreateTransaction` (HCS), `TokenCreateTransaction` / `TokenAssociateTransaction` / `TokenFreezeTransaction` / `TokenWipeTransaction` (HTS bond), `KeyList` (2-of-2 wipe key) / `CustomFractionalFee`, `AccountCreateTransaction` + `setECDSAKeyWithAlias`, `AccountBalanceQuery`, `PrivateKey.fromStringECDSA` |
| **Hedera Consensus Service (HCS)** | 3 topics — **registry** (`0.0.9744593`, identities), **trades** (`0.0.9744594`), **verdicts** (`0.0.9744595`) — the identity directory + audit trail |
| **Hedera Token Service (HTS)** | Two tokens: settlement rides **USDC** (`0.0.429274`), and the **ReputationBond** (`ARBOND`) is created via SDK with a **custom fractional fee** + **freeze/pause/wipe compliance controls**; on fraud a **2-of-2 multi-sig `TokenWipe`** (wipeKey = `KeyList` [verifier, auditor]) destroys it; bond balance = on-chain reputation (`scripts/setup-hts-token.ts`, `packages/shared/src/hts.ts`) |
| **Hedera Agent Kit** (`hedera-agent-kit` v3) | The buyer agent registers its HCS-14-style identity via the kit's `HederaLangchainToolkit` + `coreConsensusPlugin` → `submit_topic_message_tool` (autonomous mode) |
| **HCS-14-style (Universal Agent IDs)** | Every actor's on-chain identity: `uaid:aid:hedera:testnet:0.0.x` |
| **x402 + `@x402/hedera`** | `ExactHederaScheme` + `createClientHederaSigner` for USDC (or HBAR via `SETTLEMENT_ASSET=hbar`) settlement on `hedera:testnet`; hosted facilitator ladder (fee-sponsored) |
| **Mirror Node REST API** | Reading topic messages, balances, and tx history (dashboard audit panel + verifier + our proofs) |
| **Hashscan** | Explorer links for every payment, stake, slash, token, freeze, multi-sig wipe, and topic |
| **Hedera Portal / Testnet** | Operator account + funding |

## 4. Development stack

| Area | Tools |
|---|---|
| Language / runtime | **TypeScript**, **Node 22** (required — pnpm 11), **tsx** |
| Monorepo | **pnpm workspaces** (`agent`, `provider`, `exchange`, `verifier`, `shared`, `dashboard`) |
| LLM | **Groq** (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`) — providers' inference + the agent's reasoning brain |
| Backends | **Express** + **Server-Sent Events** (agent-server, exchange) |
| Frontend | **Next.js 15** + **React 19** + **Tailwind CSS 4** + **Recharts** |
| Tests | **node:test** (agent: budget/loop/buy/identity), **Vitest** (verifier: audit-selection/similarity/verification) |
| Hosting | **Railway** (backends, one service per process via a shared **Dockerfile**), **Vercel** (frontend) |
| Dev workflow | **Claude Code** with the **superpowers** skills (TDD, planning, verification) |

## See also
- [`DEPLOY.md`](DEPLOY.md) — production URLs, per-service config, demo runbook
- [`TRANSACTIONS.md`](TRANSACTIONS.md) — on-chain receipts + how staking works (no contract)
- [`agent.md`](agent.md) — the buyer agent in depth
