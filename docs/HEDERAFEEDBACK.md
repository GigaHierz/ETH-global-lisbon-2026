# Hedera Developer Feedback — AgentRouter (ETHGlobal Lisbon 2026)

Feedback from building **AgentRouter** — an inference marketplace where AI agents pay per LLM
request in native HBAR over x402, providers stake collateral, register HCS-14-style identities on
the Hedera Consensus Service (via the Hedera Agent Kit), and hold an **HTS ReputationBond**, and a
verifier slashes providers that lie about their model — destroying the bond with a **2-of-2
multi-sig `TokenWipe`** (verifier + auditor).

**Our setup:** TypeScript pnpm monorepo, `@hiero-ledger/sdk` 2.85, `@x402/hedera` 2.19,
Hedera Agent Kit, Hedera Testnet. We took it from mock mode to real on-chain settlement in one
session. We filed the concrete, reproducible problems as issues (below) and captured the rest as
honest narrative — separating what worked, what caused friction, and what wasn't Hedera's fault, so
the useful signal is easy to find.

---

## 🗂 Issues we filed on Hedera repos

| # | Repo | Issue | What it's about |
|---|---|---|---|
| 1 | `hashgraph/hedera-agent-kit-js` | [#1030](https://github.com/hashgraph/hedera-agent-kit-js/issues/1030) | **Adopt the Hiero-renamed `@hiero-ledger/sdk`.** The kit pins the legacy `@hashgraph/sdk`, so projects on the current Hiero SDK must add a *second* SDK just for the kit, and `Client` objects aren't interchangeable. |
| 2 | `hashgraph/hedera-agent-kit-js` | [#1031](https://github.com/hashgraph/hedera-agent-kit-js/issues/1031) | **Docs: programmatic single-tool invocation.** How to call one tool directly (e.g. submit an HCS message) without an LLM in the loop — we had to reverse-engineer it from the exports. |
| 3 | `hashgraph/hedera-agent-kit-js` | [#1032](https://github.com/hashgraph/hedera-agent-kit-js/issues/1032) | **Docs: which package to install.** `docs.hedera.com` references `@hashgraph/hedera-agent-kit` (v4) but the mature npm package is `hedera-agent-kit` (v3); clarify which is recommended. |
| 4 | `hiero-ledger/hiero-sdk-js` | [#4287](https://github.com/hiero-ledger/hiero-sdk-js/issues/4287) | **Clearer key errors.** A wrong-length key to `fromStringECDSA` gives *"got object"*, and a key that doesn't match the account gives a bare `INVALID_SIGNATURE` — neither points at the real cause. |
| 5 | `hedera-dev/hedera-skills` | [#17](https://github.com/hedera-dev/hedera-skills/issues/17) | **Add an HCS-14 agent-identity skill.** No skill covers giving an agent an on-chain identity (HCS-14 UAID), registering it to a topic, and discovering agents via the Mirror Node — a core agentic-payments need. |

### Context: the SDK naming (for anyone confused, like we were)

`@hashgraph/sdk` and `@hiero-ledger/sdk` are the **same SDK, dual-published** — Hedera moved its code
into **Hiero**, a vendor-neutral **Linux Foundation** project. Both packages build from the same repo
(`hiero-ledger/hiero-sdk-js`, which the old `hashgraph/hedera-sdk-js` now redirects to).
`@hiero-ledger/sdk` is the current name; `@hashgraph/sdk` is the legacy alias. Issue #1 above is that
the **Agent Kit still pins the legacy name**, forcing dual-SDK projects. The rename is also not yet
reflected across docs, tutorials, and AI coding assistants, which still default to `@hashgraph/sdk`.

---

## ✅ What worked really well

Most of the Hedera stack was the *smooth* part of this build — genuine positives worth keeping.

- **SDK-native staking/slashing with no Solidity.** We implemented the entire economic loop —
  stake, escrow, slash — with plain `TransferTransaction`s (`@hiero-ledger/sdk`). Not having to
  deploy and audit a staking contract for an MVP was a real accelerator, and this "No-Solidity" path
  deserves more prominence in Hedera's agent/DeFi getting-started material.
- **HCS as a discovery + audit substrate.** Three HCS topics (registry / trades / verdicts) gave us
  an on-chain, Mirror-Node-readable directory + tamper-evident audit trail. `TopicMessageSubmit` +
  Mirror Node REST "just worked."
- **x402 on `hedera:testnet` settled first try.** `@x402/hedera` (`ExactHederaScheme`,
  `createClientHederaSigner`) plus the hosted facilitator ladder
  (`api.testnet.blocky402.com` → `x402.org/facilitator`) settled real HBAR with fee sponsorship, so
  payers needed zero gas. Our strict smoke gate (402 → paid → exact tinybar balance deltas, twice)
  passed on the first real run.
- **Account creation + funding from an operator** via `AccountCreateTransaction` +
  `setECDSAKeyWithAlias` was clean and scriptable (no faucet on the critical path).
- **Deterministic, fast finality** made the demo reliable to run live.

---

## 🟡 Additional friction & suggestions (not yet filed as issues)

Smaller observations that didn't warrant a separate issue but are worth Hedera DevRel's attention.

### A canonical end-to-end "HCS-14 identity + x402 HBAR" example (docs)
Beyond the skills request (issue #5), a single copy-pasteable, runnable example tying **HCS-14
identity + HCS registry discovery + x402 HBAR settlement** together would have saved us assembling
it from package source + specs. That's exactly the agent-commerce pattern Hedera is promoting, and
it's the one thing we had to piece together ourselves.

### Mirror Node lag deserves a callout in getting-started (docs)
Mirror Node reflects a submitted topic message with a ~1–5 s lag. Expected and fine, but the first
time you submit a registration and don't see it immediately, it *looks* like a bug. A one-line
"poll, don't assume failure — consensus messages appear within a few seconds" note in the HCS/Mirror
Node quickstarts would prevent a phantom debugging session.

### `TokenWipe` (and other HTS admin ops) can't be scheduled — `SCHEDULED_TRANSACTION_NOT_IN_WHITELIST` (real, reproducible)
We wanted a **multi-sig, keeper-less token compliance action**: a `TokenWipe` whose wipeKey is a
2-of-2 `KeyList` [verifier, auditor], collected asynchronously via the **Schedule Service**
(`ScheduleCreate` → `ScheduleSign` → execute). On Hedera Testnet this fails at `ScheduleCreate`:

```
receipt … contained error status SCHEDULED_TRANSACTION_NOT_IN_WHITELIST
```

`TokenWipe` (and, we believe, most HTS admin operations) is not in the Schedule Service
`scheduling.whitelist`, so it can't be scheduled at all. We fell back to a **direct 2-of-2
`TokenWipe`** (both signatures on one transaction), which works — but the async, keeper-less
"propose-then-approve" pattern the Schedule Service is pitched for is unavailable for token
compliance ops. Two asks:
- **Document the whitelist** — publish the current testnet `scheduling.whitelist` so builders know
  up front which tx types are schedulable (today you only find out via the error).
- **Consider expanding it** to HTS admin ops (`TokenWipe`/`TokenFreeze`/`TokenMint`/…) — multi-sig
  token compliance via scheduled transactions is exactly the "no keeper" governance pattern Hedera
  promotes for the agent economy.

> **Candidate issue to file** on `hiero-ledger/hiero-consensus-node` (and a docs note on
> `hedera-dev`): the `SCHEDULED_TRANSACTION_NOT_IN_WHITELIST` above, with the minimal repro
> (`ScheduleCreate(TokenWipe)` on testnet) — asking for the whitelist to be documented and, ideally,
> extended to HTS admin ops. Reproduced during [issue #51](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/51).

### Two smaller HTS gotchas worth a canonical example (docs)
- **Associate-before-grant ordering.** An account must be associated (`TokenAssociateTransaction`,
  signed by that account) *before* the treasury can transfer the bond to it — obvious in hindsight,
  but a runnable "create → associate → grant" snippet would save a round-trip.
- **Treasury fee exemption.** That the treasury/fee-collector is exempt from a token's own
  `CustomFractionalFee` (so grants are fee-free while peer transfers pay) is correct but easy to
  second-guess without a note in the custom-fee docs.

### Agent Kit single-tool invocation also bites the token plugin (extends #1031)
Issue #1031 (undocumented programmatic single-tool invocation) is not consensus-specific: the
same gap applies to the Agent Kit's **account/token plugins** — if you want an agent to run a
single HTS operation (create/associate/transfer/freeze/wipe) without an LLM in the loop, there's
no documented `tool.invoke(...)` path. We used the Hiero SDK directly for the bond rather than
route it through the kit, partly for this reason (and partly for the dual-SDK issue #1030 — our
bond code is `@hiero-ledger/sdk`, the kit path is `@hashgraph/sdk`).

### Testnet HBAR is tight for multi-account demos (portal/faucet)
Our demo fans out into 8 accounts (agent, exchange, 4 providers, verifier, escrow) at ~100 ℏ each
plus stakes; the operator dropped from 1000 → ~315 ℏ. The `portal.hedera.com` allowance is workable
but tight. A higher allowance for verified hackathon accounts, or a documented pattern for demos
that need many funded accounts, would help.

---

## ⚪ Not Hedera's fault (for credibility)

Most of our *actual* blockers were environment / our own code, not Hedera. Listed so the signal
above stays honest:

- Node.js/pnpm weren't installed on the dev machine.
- Our own `scripts/demo.ts` used `spawn("npx", …)` without `shell:true`, which fails on Windows.
- Windows PowerShell execution policy blocked `pnpm.ps1` (worked around with `pnpm.cmd`).
- `@x402/*` vs legacy unscoped `x402-*` package confusion — that's **Coinbase's x402**, not Hedera.

---

## TL;DR for Hedera DevRel

Hedera itself was the smooth part of this build — SDK-native staking, HCS, and x402/HBAR settlement
worked first try. The highest-leverage improvements are **developer experience and docs**, not the
platform:

1. **Agent Kit should adopt `@hiero-ledger/sdk`** (issue #1030) and document **single-tool
   invocation across all plugins** (issue #1031 — not just consensus; the token plugin bites too),
   and the rename should be signposted everywhere, including for AI coding assistants that still
   emit `@hashgraph/sdk`.
2. **Ship one canonical, runnable HCS-14 identity + x402 HBAR example** (relates to #17) — the exact
   agent-economy use case Hedera is pitching, and the one thing we had to assemble ourselves.
3. **Document (and ideally expand) the Schedule Service whitelist** — `TokenWipe` isn't schedulable
   on testnet (`SCHEDULED_TRANSACTION_NOT_IN_WHITELIST`), which blocks multi-sig, keeper-less HTS
   compliance actions (candidate issue above). The reputation/compliance primitive for agent
   marketplaces.
4. **Clearer SDK error messages** for key mismatches (issue #4287).

*— The AgentRouter team, ETHGlobal Lisbon 2026*
