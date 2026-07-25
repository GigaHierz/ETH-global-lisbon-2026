# HEDERAFEEDBACK.md — feedback filed to the Hedera ecosystem

While building AgentRouter on Hedera Testnet we hit a few friction points in the SDK, the Agent
Kit, and the skills. We filed them as concrete, reproducible issues (with versions, code, and error
output) so the Hedera teams can improve the developer experience.

## Issues we opened

| # | Repo | Issue | What it's about |
|---|---|---|---|
| 1 | `hashgraph/hedera-agent-kit-js` | [#1030](https://github.com/hashgraph/hedera-agent-kit-js/issues/1030) | **Adopt the Hiero-renamed `@hiero-ledger/sdk`.** The kit pins the legacy `@hashgraph/sdk`, so projects on the current Hiero SDK must add a *second* SDK just for the kit, and `Client` objects aren't interchangeable. |
| 2 | `hashgraph/hedera-agent-kit-js` | [#1031](https://github.com/hashgraph/hedera-agent-kit-js/issues/1031) | **Docs: programmatic single-tool invocation.** How to call one tool directly (e.g. submit an HCS message) without an LLM in the loop — we had to reverse-engineer it from the exports. |
| 3 | `hashgraph/hedera-agent-kit-js` | [#1032](https://github.com/hashgraph/hedera-agent-kit-js/issues/1032) | **Docs: which package to install.** `docs.hedera.com` references `@hashgraph/hedera-agent-kit` (v4) but the mature npm package is `hedera-agent-kit` (v3); clarify which is recommended. |
| 4 | `hiero-ledger/hiero-sdk-js` | [#4287](https://github.com/hiero-ledger/hiero-sdk-js/issues/4287) | **Clearer key errors.** A wrong-length key to `fromStringECDSA` gives *"got object"*, and a key that doesn't match the account gives a bare `INVALID_SIGNATURE` — neither points at the real cause. |
| 5 | `hedera-dev/hedera-skills` | [#17](https://github.com/hedera-dev/hedera-skills/issues/17) | **Add an HCS-14 agent-identity skill.** No skill covers giving an agent an on-chain identity (HCS-14 UAID), registering it to a topic, and discovering agents via the Mirror Node — a core agentic-payments need. |

## Context: the SDK naming (for anyone confused, like we were)

`@hashgraph/sdk` and `@hiero-ledger/sdk` are the **same SDK, dual-published** — Hedera moved its code
into **Hiero**, a vendor-neutral **Linux Foundation** project. Both packages build from the same repo
(`hiero-ledger/hiero-sdk-js`, which the old `hashgraph/hedera-sdk-js` now redirects to).
`@hiero-ledger/sdk` is the current name; `@hashgraph/sdk` is the legacy alias. Issue #1 above is that
the **Agent Kit still pins the legacy name**, forcing dual-SDK projects.

## What we used from Hedera (that worked well)

For balance — most of the stack was smooth: the Hedera SDK (`TransferTransaction`, HCS
`TopicMessageSubmitTransaction`, account creation), the **Hedera Consensus Service** for identity +
audit, **HCS-14** Universal Agent IDs, **x402 + `@x402/hedera`** for HBAR settlement, and the
**Mirror Node** REST API. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full stack and
[`TRANSACTIONS.md`](TRANSACTIONS.md) for on-chain proof.
