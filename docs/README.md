# AgentRouter documentation

AgentRouter is an on-chain inference exchange: AI agents buy LLM inference per request with
USDC over x402, from providers identity- and reputation-tracked on Hedera Consensus Service,
with a verifier that catches providers serving cheaper models than advertised and slashes
their staked HBAR. Everything on-chain runs on Hedera Testnet.

Start at the root [README](../README.md) for the quickstart and architecture overview, then
use the documents below.

## Overview and architecture

- [ARCHITECTURE.md](ARCHITECTURE.md) — the three autonomous actors, the end-to-end flow, and
  the Hedera SDK / tooling stack.
- [GUIDE.md](GUIDE.md) — consolidated reference: env vars, demo script, components,
  troubleshooting.

## Services

- [agent.md](agent.md) — the autonomous buyer agent.
- [provider.md](provider.md) — the inference provider (supply side, four personalities).
- [exchange.md](exchange.md) — the routing + settlement core.
- [verifier.md](verifier.md) — the fraud auditor that slashes cheaters.
- [FRONTEND.md](FRONTEND.md) — dashboard component and styling conventions.

## Agent tooling

- [`packages/provider-mcp`](../packages/provider-mcp/README.md) — MCP server exposing provider
  onboarding as callable tools (account, stake, HCS-14 registration, liveness verification).
- [`.claude/skills/onboarding-a-provider`](../.claude/skills/onboarding-a-provider/SKILL.md) —
  the guided zero-to-live walkthrough. Uses the MCP tools when they're connected and the `pnpm`
  commands when they aren't.

## Operations

- [DEPLOY.md](DEPLOY.md) — production URLs, per-service configuration, and the demo runbook.
- [TESTING.md](TESTING.md) — shared live test URLs.
- [FUNDING.md](FUNDING.md) — the Hedera Testnet funding / settlement decisions.
- [MIGRATION-USDC.md](MIGRATION-USDC.md) — moving an existing deployment from HBAR to USDC
  settlement: account association, funding, and the per-service variable changes.

## On-chain proof and reference

- [PROOF.md](PROOF.md) — live Hashscan links for real x402 settlements, demo accounts, and
  the HCS audit topics.
- [TRANSACTIONS.md](TRANSACTIONS.md) — on-chain receipts and how native staking / slashing
  works without a smart contract.
- [RESEARCH.md](RESEARCH.md) — verified integration research: x402 package APIs, HCS-14
  identity, Groq model IDs, with sources.
- [DEVREL_BRIEF.md](DEVREL_BRIEF.md) — narrative, demo beats, and real-vs-mocked breakdown.
- [HEDERAFEEDBACK.md](HEDERAFEEDBACK.md) — Hedera developer-experience feedback.
