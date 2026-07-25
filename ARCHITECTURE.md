# ARCHITECTURE.md — the agents, how they work, and the Hedera stack

AgentRouter is a **spot market for LLM inference**: AI agents buy inference per request, pay in
**real HBAR over x402**, providers stake a bond, and a verifier slashes fraud — all on **Hedera
Testnet**, native (no smart contract).

## 1. What the agents do

There are three kinds of autonomous actors, each with its own Hedera account + HCS-14 identity:

### 🤖 The buyer agent (`agent/`)
An autonomous agent with its own wallet that **accomplishes a goal by buying inference**:
- Registers an **HCS-14 identity** (`uaid:aid:hedera:testnet:0.0.9746264`) on-chain.
- Given a goal, **plans** sub-questions, **buys** an answer to each through the exchange (paying
  real HBAR via x402 from its own account), and **synthesizes** a result.
- **Budget-aware**: it stops the moment the next purchase would exceed `AGENT_BUDGET_HBAR`.

### 🏭 The provider agents (`provider/`, supply side)
One codebase, four "personalities" (Titan, Budget, NimbusAI, SketchyGPU):
- Register an HCS-14 identity + advertised model/price to the registry topic.
- **Stake 50 ℏ** to an escrow account as a quality bond.
- Serve inference (proxying Groq) behind an x402 paywall.
- One of them (**SketchyGPU**) is a **cheater**: it advertises a 70B model but secretly serves 8B.

### ⚖️ The verifier agent (`verifier/`)
An autonomous auditor:
- Samples routed requests from the exchange log, **replays** a prompt (temperature 0) against the
  accused provider **and an honest witness** on the same model.
- Measures answer divergence (unicode-safe bigram-Jaccard); below threshold ⇒ **fraud**.
- **Slashes** the cheater's stake on-chain (escrow → treasury) and publishes the verdict to HCS.

*(The `exchange/` is the marketplace hub — routing + x402 paywall — not an autonomous agent.)*

## 2. How they work — the flow

```
provider ──stake 50 ℏ──▶ escrow account          provider ──register──▶ HCS registry topic
agent ──register HCS-14──▶ registry topic
agent goal ─▶ plan (Groq) ─▶ for each question:
    agent ──0.12 ℏ x402──▶ exchange ──routes to cheapest──▶ provider ──▶ Groq completion
    (exchange keeps the spread; every buy logged to the trades topic)
verifier ─▶ sample log ─▶ replay accused vs witness ─▶ divergent? ─▶ slash 25 ℏ + verdict to HCS
```

- **Payments** are x402: an HTTP 402 challenge → the payer signs an HBAR transfer → a facilitator
  settles it on Hedera (fee-sponsored) → the request proceeds.
- **Identity + audit** are HCS: agents/providers register to the *registry* topic; trades and
  verdicts stream to their own topics — a tamper-evident, Mirror-Node-readable trail.
- **Staking/slashing** is native: an HBAR transfer into an escrow *account*, and a transfer out
  signed by the escrow key the verifier holds. No contract (see `TRANSACTIONS.md`).

## 3. What we use from the Hedera SDK & tooling

| Piece | Where / how we use it |
|---|---|
| **Hedera SDK** (`@hiero-ledger/sdk`) | `TransferTransaction` (x402 HBAR payments, 50 ℏ stakes, 25 ℏ slash), `TopicMessageSubmitTransaction` (HCS writes), `AccountCreateTransaction` + `setECDSAKeyWithAlias` (account setup), `AccountBalanceQuery`, `TokenAssociateTransaction`, `PrivateKey.fromStringECDSA` |
| **Hedera Consensus Service (HCS)** | 3 topics — **registry** (`0.0.9744593`, identities), **trades** (`0.0.9744594`), **verdicts** (`0.0.9744595`) — the identity directory + audit trail |
| **Hedera Agent Kit** (`hedera-agent-kit` v3) | The buyer agent registers its HCS-14 identity via the kit's `HederaLangchainToolkit` + `coreConsensusPlugin` → `submit_topic_message_tool` (autonomous mode) |
| **HCS-14 (Universal Agent IDs)** | Every actor's on-chain identity: `uaid:aid:hedera:testnet:0.0.x` |
| **x402 + `@x402/hedera`** | `ExactHederaScheme` + `createClientHederaSigner` for HBAR settlement on `hedera:testnet`; hosted facilitator ladder (fee-sponsored) |
| **Hedera Token Service (HTS)** | Optional USDC settlement path (token `0.0.429274`); accounts associate it in setup |
| **Mirror Node REST API** | Reading topic messages, balances, and tx history (dashboard audit panel + verifier + our proofs) |
| **Hashscan** | Explorer links for every payment, stake, slash, and topic |
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
- [`agent/README.md`](agent/README.md) — the buyer agent in depth
