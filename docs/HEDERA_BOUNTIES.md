# AgentRouter × Hedera prize tracks

How AgentRouter maps to the Hedera bounties we target at ETHGlobal Lisbon 2026 — **AI &
Agentic Payments (#1)**, **Tokenization (#2)**, and **"No Solidity Allowed" (#3)**. Every
"Implemented" line is real and SDK-native — **no Solidity anywhere** — across three Hedera
services: **Hedera Consensus Service (HCS)**, **Hedera Token Service (HTS)**, and the
**Mirror Node REST API**. "Natural extension" lines are explicitly *not yet built*.

One-liner: **AgentRouter is an on-chain OpenRouter for agentic payments — autonomous AI agents
buy LLM inference per request with USDC over x402 (native HBAR behind a flag; sub-second finality,
low predictable fees), providers carry an HCS-14-style identity via the Hedera Agent Kit plus an HTS
ReputationBond, and a verifier that catches model fraud slashes staked HBAR and destroys the
bond with a 2-of-2 multi-sig `TokenWipe`.**

The stack, verified against code (not docs): x402 (`@x402/*` 2.19, `exact` on `hedera:testnet`,
fee-sponsored facilitator ladder), **Hedera Agent Kit** (`hedera-agent-kit`), **Hiero SDK**
(`@hiero-ledger/sdk`), **HCS** (registry/trades/verdicts/agentCalls topics), **HTS** (ReputationBond
`ARBOND` with custom fee + 2-of-2 multi-sig wipe), **Mirror Node REST**, LangChain, Hashscan.

---

## 1 · AI & Agentic Payments on Hedera — **Implemented (primary)**

Build AI agents executing autonomous payments on Hedera using sub-second finality and
predictable fees, with the Hedera Agent Kit, Agent Commerce Protocol, and the x402 payment
standard.

**What we implement**
- **Autonomous AI agent making agentic payments** — the buyer plans a goal into questions and
  pays for each answer per request. `packages/agent/src/loop.ts`, `packages/agent/src/buy.ts`.
- **Durable per-agent on-chain purchase history** — the agent publishes every paid inference call
  to its **own HCS topic** (`agentCalls`) and reads it back through the Mirror Node, giving a
  verifiable record of every x402 purchase that survives restarts. Surfaced as "Previous Calls" on
  the Agent page. `packages/agent/src/server.ts` (`recordCall`, `GET /calls`). The exchange applies
  the same principle to its settlement feed: on boot it **replays the HCS trades topic** to rebuild
  the feed and revenue counters (`packages/exchange/src/hydrate.ts` `hydrateFromTrades`, wired at
  `packages/exchange/src/index.ts:67`), so the ledger — not container uptime — decides what the demo
  shows. A rehydrated row is deliberately partial (money + both settlement tx ids, not the prompt
  text or provider URL).
- **x402 payment standard, USDC (native HBAR behind a flag), per request** — official `@x402/*` 2.19,
  `ExactHederaScheme` on `hedera:testnet`, signed with the agent's own key; the exchange/provider run
  the x402 paywall. `packages/agent/src/payer.ts:25-53`, `packages/exchange/src/index.ts` (x402
  resource server ~L128-136), `packages/provider/src/index.ts:63-89` (real `ExactHederaScheme`
  paywall; L51-61 is the MOCK branch). Fee-sponsored facilitator ladder:
  `packages/shared/src/hedera.ts:43-76` (payers need zero gas).
- **Hedera Agent Kit** — the agent registers its **HCS-14-style Universal Agent ID**
  (`uaid:aid:hedera:testnet:0.0.x`) through `HederaLangchainToolkit` + `coreConsensusPlugin`
  (`SUBMIT_TOPIC_MESSAGE_TOOL`, `AgentMode.AUTONOMOUS`). `packages/agent/src/identity.ts:77-97`,
  dep `packages/agent/package.json`.
- **Sub-second finality, low predictable fees** — inherent Hedera Testnet properties this design
  relies on for per-request machine payments.
- **Optional enhancements, also implemented:** multi-agent system (buyer agent + provider
  agents + verifier), **x402 pay-per-request APIs**, **ERC-8004 / HCS-14-style agent identity**,
  **token creation + custom fee schedules via HTS** (see track 2), **2-of-2 multi-sig HTS
  compliance controls** (see track 2), and **HCS audit trails**
  (registry/trades/verdicts + a per-agent `agentCalls` purchase log).

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
- **Compliance controls** — the token is created with **freeze**, **pause**, and **wipe** keys.
  Freeze key = verifier; wipe key = **2-of-2 `KeyList` [verifier, auditor]**.
  `scripts/setup-hts-token.ts`.
- **2-of-2 multi-sig wipe** — on fraud the verifier destroys the cheater's bond with a
  `TokenWipeTransaction` that carries **two signatures** (verifier + auditor) — reputation → 0
  on-chain, no single party can do it alone, no keeper. `packages/shared/src/hts.ts`
  (`multiSigWipeBond`). (`TokenWipe` isn't in the Schedule Service whitelist, so the multi-sig
  is a direct two-signature transaction — see `HEDERAFEEDBACK.md`.)
- **Token lifecycle operations** — create → associate → grant (mint/transfer to providers) →
  2-of-2 multi-sig wipe on fraud. Balance per provider *is* on-chain reputation.
- **Verifiable on Hashscan** — the token, grants, freeze, and multi-sig wipe are all native HTS
  transactions; **executed on Hedera Testnet 2026-07-26**, links in `docs/PROOF.md` (token
  `0.0.9758338`).

**Natural extension** — real asset classes (securities, invoices, carbon credits) with KYC keys;
`@hiero-ledger/hiero-contracts`; cross-chain token operations (LayerZero/CCIP/HashPort);
oracle-priced bonds.

**Qualification:** create/manage tokens with HTS via SDK ✓ · deployed on Hedera Testnet ✓ ·
public repo + Hashscan-visible token ✓ · demo video (to record).

---

## 3 · "No Solidity Allowed" — Build with Hedera SDKs — **Implemented**

Applications using only the Hedera SDK, no smart contracts.

**What we implement** — **the entire economic loop is SDK-native with zero Solidity**, spanning
**three native Hedera services** (the bounty asks for two):
- **HCS** — identity registry + trade + verdict topics, plus a per-agent `agentCalls` topic that
  is the buyer agent's own durable purchase log (read back via Mirror Node to power the Agent
  page's "Previous Calls" view). These topics *are* the source of truth: on boot the exchange
  replays the trades topic to rebuild its settlement feed (`packages/exchange/src/hydrate.ts`),
  mirroring how `discovery.ts` rebuilds the provider table from the registry topic. `packages/shared/src/hcs.ts`,
  `packages/agent/src/server.ts`, `deployments.json`.
- **HTS** — the ReputationBond token, custom fee, freeze/pause/wipe keys, and the 2-of-2 multi-sig
  wipe. `scripts/setup-hts-token.ts`, `packages/shared/src/hts.ts`.
- **Mirror Node REST API** — provider discovery + audit-trail reads.
  `packages/shared/src/hcs.ts:70-87`, `packages/exchange/src/discovery.ts`.
- **Staking + slashing without contracts** — native-HBAR escrow via `TransferTransaction`.
  Stake `packages/provider/src/registry.ts:40-55`; slash `packages/verifier/src/index.ts:115-143`.
- **Hedera JS/TS SDK exclusively** — `@hiero-ledger/sdk` throughout; `@hashgraph/sdk` only where
  the Hedera Agent Kit pins it. **No `.sol` files in the repo.**

**Qualification:** Hedera SDK exclusively, no contracts ✓ · ≥2 native services (we use 3) ✓ ·
public repo + README ✓ · demo video (to record). Optional: Mirror Node ✓, HCS ✓, Hedera Agent
Kit ✓.

---

## Links & references

Every Hedera tool/service we use, its official docs, and the exact code where we use it. Code
links are **permalinks pinned to commit [`ef3a140`](https://github.com/GigaHierz/ETH-global-lisbon-2026/tree/ef3a140)**
(on `main`) so the line anchors stay stable.

| Hedera tool / service | Official docs / repo | Where we use it (exact lines) |
| --- | --- | --- |
| **Hedera Consensus Service (HCS)** | [SDK docs](https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service) | publish → [`hcs.ts#L39-L68`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/shared/src/hcs.ts#L39-L68) · read → [`hcs.ts#L70-L87`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/shared/src/hcs.ts#L70-L87) · boot replay → [`hydrate.ts#L78-L92`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/exchange/src/hydrate.ts#L78-L92) |
| **Hedera Token Service (HTS)** | [SDK docs](https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service) | token create + custom fee + keys → [`setup-hts-token.ts#L94-L107`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/scripts/setup-hts-token.ts#L94-L107) · 2-of-2 multi-sig wipe → [`hts.ts#L110-L145`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/shared/src/hts.ts#L110-L145) |
| **Mirror Node REST API** | [REST API docs](https://docs.hedera.com/hedera/sdks-and-apis/rest-api) | topic reads → [`hcs.ts#L70-L87`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/shared/src/hcs.ts#L70-L87) · provider discovery → [`discovery.ts`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/exchange/src/discovery.ts) |
| **Hedera Agent Kit** (`hedera-agent-kit`) | [repo](https://github.com/hashgraph/hedera-agent-kit-js) · [docs](https://docs.hedera.com/solutions/ai/agent-kit) | `HederaLangchainToolkit` + `SUBMIT_TOPIC_MESSAGE_TOOL` (autonomous mode) → [`identity.ts#L77-L97`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/agent/src/identity.ts#L77-L97) |
| **Hiero SDK** (`@hiero-ledger/sdk`) | [repo](https://github.com/hiero-ledger/hiero-sdk-js) | stake via `TransferTransaction` → [`registry.ts#L40-L55`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/provider/src/registry.ts#L40-L55) · slash → [`verifier/index.ts#L115-L143`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/verifier/src/index.ts#L115-L143) |
| **x402** (`@x402/*`, incl. `@x402/hedera`) | [repo](https://github.com/x402-foundation/x402) · [docs](https://docs.x402.org) | client / `ExactHederaScheme` → [`payer.ts#L25-L53`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/agent/src/payer.ts#L25-L53) · resource-server paywall → [`provider/index.ts#L63-L89`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/provider/src/index.ts#L63-L89) · fee-sponsored facilitator ladder → [`hedera.ts#L43-L76`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/packages/shared/src/hedera.ts#L43-L76) |
| **Hashscan** (explorer) | [testnet](https://hashscan.io/testnet) | ARBOND bond token → [`0.0.9758338`](https://hashscan.io/testnet/token/0.0.9758338); full tx list in [`docs/PROOF.md`](https://github.com/GigaHierz/ETH-global-lisbon-2026/blob/ef3a140/docs/PROOF.md) |

`@hashgraph/sdk` also appears, but only where the Hedera Agent Kit pins it — the Hiero SDK
(`@hiero-ledger/sdk`) is what we call directly everywhere else.

---

### Truthfulness note

`sub-second finality` and `low, predictable fees` are stated as Hedera network properties, not
benchmarks we ran. Identity is **HCS-14-*style*** (the code says so), interoperable with but not
a certified HCS-14 registry. For the live demo the verifier holds *both* wipe-key signatures so
the multi-sig wipe runs end-to-end; in production the auditor is an independent second signer.
`Schedule Service` was explored but `TokenWipe` isn't in its testnet whitelist (see
`HEDERAFEEDBACK.md`), so the wipe is a direct 2-of-2 transaction. `ACP`, `Guardian`, oracles,
and TEE/zkML are roadmap, never claimed as built.
