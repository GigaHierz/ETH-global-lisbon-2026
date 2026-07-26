# AgentRouter × Hedera prize tracks

How AgentRouter maps to the Hedera bounties we target at ETHGlobal Lisbon 2026 — **AI &
Agentic Payments (#1)**, **Tokenization (#2)**, and **"No Solidity Allowed" (#3)**. Every
"Implemented" line is real and SDK-native — **no Solidity anywhere** — across four Hedera
services: **Hedera Consensus Service (HCS)**, **Hedera Token Service (HTS)**, **Hedera
Schedule Service**, and the **Mirror Node REST API**. "Natural extension" lines are explicitly
*not yet built*.

One-liner: **AgentRouter is an on-chain OpenRouter for agentic payments — autonomous AI agents
buy LLM inference per request with native HBAR over x402 (sub-second finality, low predictable
fees), providers carry an HCS-14-style identity via the Hedera Agent Kit plus an HTS
ReputationBond, and a verifier that catches model fraud slashes staked HBAR, freezes the bond,
and multi-sig scheduled-wipes it.**

The stack, verified against code (not docs): x402 (`@x402/*` 2.19, `exact` on `hedera:testnet`,
fee-sponsored facilitator ladder), **Hedera Agent Kit** (`hedera-agent-kit`), **Hiero SDK**
(`@hiero-ledger/sdk`), **HCS** (registry/trades/verdicts topics), **HTS** (ReputationBond
`ARBOND`), **Schedule Service** (multi-sig wipe), **Mirror Node REST**, LangChain, Hashscan.

---

## 1 · AI & Agentic Payments on Hedera — **Implemented (primary)**

Build AI agents executing autonomous payments on Hedera using sub-second finality and
predictable fees, with the Hedera Agent Kit, Agent Commerce Protocol, and the x402 payment
standard.

**What we implement**
- **Autonomous AI agent making agentic payments** — the buyer plans a goal into questions and
  pays for each answer per request. `packages/agent/src/loop.ts`, `packages/agent/src/buy.ts`.
- **x402 payment standard, native HBAR, per request** — official `@x402/*` 2.19, `ExactHederaScheme`
  on `hedera:testnet`, signed with the agent's own key; the exchange/provider run the x402
  paywall. `packages/agent/src/payer.ts:25-53`, `packages/exchange/src/index.ts` (x402
  resource server ~L128-136), `packages/provider/src/index.ts:55-61`. Fee-sponsored facilitator ladder:
  `packages/shared/src/hedera.ts:43-76` (payers need zero gas).
- **Hedera Agent Kit** — the agent registers its **HCS-14-style Universal Agent ID**
  (`uaid:aid:hedera:testnet:0.0.x`) through `HederaLangchainToolkit` + `coreConsensusPlugin`
  (`SUBMIT_TOPIC_MESSAGE_TOOL`, `AgentMode.AUTONOMOUS`). `packages/agent/src/identity.ts:77-97`,
  dep `packages/agent/package.json`.
- **Sub-second finality, low predictable fees** — inherent Hedera Testnet properties this design
  relies on for per-request machine payments.
- **Optional enhancements, also implemented:** multi-agent system (buyer agent + provider
  agents + verifier), **x402 pay-per-request APIs**, **ERC-8004 / HCS-14-style agent identity**,
  **token creation via HTS** (see track 2), a **scheduled token operation** (the multi-sig
  scheduled wipe, see track 2), and **HCS audit trails** (registry/trades/verdicts).

**Natural extension** — adopt OpenClaw / Virtuals **Agent Commerce Protocol (ACP)** job-lifecycle
schema on the HCS trades topic (our exchange is already an ACP-style marketplace; ACP itself is
Base-chain, so we describe rather than depend on it); **A2A** protocol interop.

**Qualification:** AI agent making ≥1 payment on Hedera Testnet ✓ · Hedera Agent Kit + x402 +
Hedera SDKs ✓ · public repo + README with setup & payment-flow architecture ✓ · demo video (to
record).

---

## 2 · Tokenization on Hedera (HTS) — **Implemented**

Real-world asset tokenization using the Hedera Token Service with compliance controls.

**What we implement** — provider **reputation is tokenized** as an HTS asset (the
`ReputationBond`, symbol `ARBOND`), created and managed entirely via the SDK, no Solidity.
- **HTS token creation via the SDK** — `TokenCreateTransaction` (fungible, 0 decimals).
  `scripts/setup-hts-token.ts`.
- **Custom fee schedules** — a `CustomFractionalFee` (2% → treasury) is the marketplace-fee /
  verifier-reward rail. `scripts/setup-hts-token.ts` (`marketplaceFee`).
- **Compliance controls** — the token is created with **freeze**, **pause**, and **wipe** keys;
  on fraud the verifier **freezes** the cheater's bond and **wipes** it. Freeze key = verifier;
  wipe key = 2-of-2 `KeyList` [verifier, auditor]. `packages/shared/src/hts.ts`
  (`freezeBond`, `scheduledWipeBond`), `scripts/setup-hts-token.ts`.
- **Scheduled token operations (Hedera Scheduled Transactions)** — the wipe executes as a
  `ScheduleCreateTransaction` requiring a 2-of-2 [verifier, auditor] signature
  (`ScheduleSignTransaction`) — multi-sig, no keeper. `packages/shared/src/hts.ts`
  (`scheduledWipeBond`, `signSchedule`).
- **Token lifecycle operations** — create → associate → grant (mint/transfer to providers) →
  freeze → scheduled wipe. Balance per provider *is* on-chain reputation.
- **Verifiable on Hashscan** — the token, grants, freeze, and wipe are all native HTS
  transactions viewable at `hashscan.io/testnet/token/<id>`; verified end-to-end in MOCK_MODE,
  with the funded real-mode run capturing the Hashscan links in `docs/PROOF.md`.

**Natural extension** — real asset classes (securities, invoices, carbon credits) with KYC keys;
`@hiero-ledger/hiero-contracts`; cross-chain token operations (LayerZero/CCIP/HashPort);
oracle-priced bonds.

**Qualification:** create/manage tokens with HTS via SDK ✓ · deployed on Hedera Testnet ✓ ·
public repo + Hashscan-visible token ✓ · demo video (to record).

---

## 3 · "No Solidity Allowed" — Build with Hedera SDKs — **Implemented**

Applications using only the Hedera SDK, no smart contracts.

**What we implement** — **the entire economic loop is SDK-native with zero Solidity**, spanning
**four native Hedera services** (the bounty asks for two):
- **HCS** — identity registry + trade + verdict topics. `packages/shared/src/hcs.ts`,
  `deployments.json`.
- **HTS** — the ReputationBond token, custom fee, freeze/pause/wipe. `scripts/setup-hts-token.ts`,
  `packages/shared/src/hts.ts`.
- **Schedule Service** — the multi-sig scheduled wipe. `packages/shared/src/hts.ts`
  (`scheduledWipeBond`, `signSchedule`).
- **Mirror Node REST API** — provider discovery + audit-trail reads.
  `packages/shared/src/hcs.ts:70-87`, `packages/exchange/src/discovery.ts`.
- **Staking + slashing without contracts** — native-HBAR escrow via `TransferTransaction`.
  Stake `packages/provider/src/registry.ts:40-55`; slash `packages/verifier/src/index.ts:115-143`.
- **Hedera JS/TS SDK exclusively** — `@hiero-ledger/sdk` throughout; `@hashgraph/sdk` only where
  the Hedera Agent Kit pins it. **No `.sol` files in the repo.**

**Qualification:** Hedera SDK exclusively, no contracts ✓ · ≥2 native services (we use 4) ✓ ·
public repo + README ✓ · demo video (to record). Optional: Mirror Node ✓, HCS ✓, Hedera Agent
Kit ✓.

---

### Truthfulness note

`sub-second finality` and `low, predictable fees` are stated as Hedera network properties, not
benchmarks we ran. Identity is **HCS-14-*style*** (the code says so), interoperable with but not
a certified HCS-14 registry. For the live demo the verifier completes *both* scheduled-wipe
signatures so the loop runs end-to-end; in production the auditor is an independent second
signer. `ACP`, `Guardian`, oracles, and TEE/zkML are roadmap, never claimed as built.
