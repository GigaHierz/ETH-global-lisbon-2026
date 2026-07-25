# Hedera Developer Feedback — AgentRouter (ETHGlobal Lisbon 2026)

Feedback from building **AgentRouter** — an inference marketplace where AI agents pay per LLM
request in native HBAR over x402, providers stake collateral and register HCS-14 identities on the
Hedera Consensus Service, and a verifier slashes providers that lie about their model.

**Our setup:** TypeScript pnpm monorepo, Windows 11 dev machine, `@hiero-ledger/sdk` 2.85,
`@x402/hedera` 2.19, Hedera Testnet. We took it from mock mode to real on-chain settlement in one
session. This doc is honest — it separates what worked, what caused friction, and what wasn't
Hedera's fault, so the useful signal is easy to find.

---

## ✅ What worked really well

These are genuine positives worth keeping.

- **SDK-native staking/slashing with no Solidity.** We implemented the entire economic loop —
  stake, escrow, slash — with plain `TransferTransaction`s (`@hiero-ledger/sdk`). Not having to
  deploy and audit a staking contract for an MVP was a real accelerator. This "No-Solidity" path is
  underrated and deserves more prominence in Hedera's agent/DeFi getting-started material.
- **HCS as a discovery + audit substrate.** Using three HCS topics (registry / trades / verdicts)
  as an on-chain, Mirror-Node-readable directory + tamper-evident audit trail was straightforward
  and mapped cleanly to our needs. `TopicMessageSubmit` + Mirror Node REST "just worked."
- **x402 on `hedera:testnet` settled first try.** `@x402/hedera` (`ExactHederaScheme`,
  `createClientHederaSigner`) plus the hosted facilitator ladder
  (`api.testnet.blocky402.com` → `x402.org/facilitator`) settled real HBAR with fee sponsorship, so
  payers needed zero gas. Our strict smoke gate (402 → paid → exact tinybar balance deltas, twice)
  passed on the first real run.
- **Account creation + funding from an operator** via `AccountCreateTransaction` +
  `setECDSAKeyWithAlias` was clean and let us script all demo accounts idempotently (no faucet on
  the critical path).
- **Deterministic, fast finality** made the demo reliable to run live.

---

## 🟡 Friction & suggestions

Ordered by how much they'd help a newcomer. Each notes whether we hit it firsthand.

### 1. SDK identity: `@hiero-ledger/sdk` vs `@hashgraph/sdk` (docs/ecosystem)
The JS SDK's move to Hiero (`@hiero-ledger/sdk`) is not yet reflected across the ecosystem —
many docs pages, blog tutorials, StackOverflow answers, and (notably) AI coding assistants still
default to `@hashgraph/sdk`. A newcomer copy-pasting examples can end up mixing packages.
*Firsthand?* No — our repo was already on `@hiero-ledger/sdk`, but this is a predictable trap.
**Suggestion:** a prominent, dated "we renamed to Hiero — here's the mapping" banner on the SDK
README and docs landing page, and a note that old examples may reference the old package.

### 2. Newer standards need more end-to-end examples (docs)
**HCS-14 (Universal Agent IDs)** and the **x402-on-Hedera** integration are both very new and central
to the "AI agents on Hedera" story Hedera is promoting. The spec pages exist
(e.g. HCS-14 at hol.org), but a copy-pasteable, end-to-end **"register an agent identity on HCS-14
and get paid via x402"** walkthrough would have saved us assembling it from package source + specs.
*Firsthand?* Partially — we succeeded, but by reading source rather than a guide.
**Suggestion:** one canonical, runnable example repo tying HCS-14 identity + HCS registry discovery
+ x402 HBAR settlement together (the exact agent-commerce pattern Hedera is pitching).

### 3. Mirror Node lag deserves a callout in getting-started (docs)
Provider discovery via the Mirror Node has a ~1–5 s lag after a topic message is submitted. This is
expected and fine, but the first time you submit a registration and don't see it immediately, it
*looks* like a bug. *Firsthand?* Yes — we accounted for it, but a newcomer might chase a phantom.
**Suggestion:** a one-line "Mirror Node reflects consensus messages within a few seconds; poll,
don't assume failure" note in HCS/Mirror Node quickstarts.

### 4. Testnet HBAR is tight for multi-account demos (portal/faucet)
Our demo needs 8 accounts (agent, exchange, 4 providers, verifier, escrow) at ~100 ℏ each plus
stakes; the operator dropped from 1000 → ~315 ℏ. The `portal.hedera.com` allowance is workable but
tight for anything that fans out into many accounts. *Firsthand?* Yes (advisory warning triggered).
**Suggestion:** either a higher testnet allowance for verified hackathon accounts, or a documented
pattern for demos that need many funded accounts.

---

## ⚪ Not Hedera's fault (for credibility)

Most of our actual blockers were **environment / our own code**, not Hedera. Listing them so the
signal above stays honest:

- Node.js/pnpm weren't installed on the dev machine.
- Our own `scripts/demo.ts` used `spawn("npx", …)` without `shell:true`, which fails on Windows.
- Windows PowerShell execution policy blocked `pnpm.ps1` (used `pnpm.cmd`).
- `@x402/*` vs legacy unscoped `x402-*` package confusion — that's **Coinbase's x402**, not Hedera.
- USDC test funding depends on `faucet.circle.com` — **Circle**, not Hedera.

---

## TL;DR for Hedera DevRel

Hedera itself was the *smooth* part of this build — SDK-native staking, HCS, and x402/HBAR
settlement worked first try. The highest-leverage improvements are **documentation**, not the
platform: (1) signpost the `@hashgraph/sdk` → `@hiero-ledger/sdk` rename everywhere (incl. for AI
assistants), and (2) ship one canonical end-to-end **HCS-14 identity + x402 HBAR** example, since
that's exactly the agent-economy use case Hedera is promoting and the one thing we had to piece
together ourselves.

*— The AgentRouter team, ETHGlobal Lisbon 2026*
