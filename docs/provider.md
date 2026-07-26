# AgentRouter — Inference Provider (Supply)

An OpenAI-compatible inference server that **sells LLM answers per request and gets paid in real
HBAR** on Hedera Testnet, over the [x402](https://x402.org) protocol. On boot it **stakes 50 ℏ of
collateral** into an escrow account and **registers an on-chain HCS-14 identity** on the shared
registry topic, so the exchange discovers it automatically. One codebase runs several env-driven
"personalities" — including a deliberate **cheater** that advertises one model but serves a weaker
one, so the verifier's slash mechanism has something real to catch.

Built on the **Hedera SDK** (identity, staking, native-HBAR escrow) + **x402** (per-request
payments) + **`@x402/express`** paywall. Everything on-chain is real testnet — no mocks.

## What it does (on boot, then per request)

1. **Stakes collateral.** A one-time `50 ℏ` transfer from the provider account to the shared
   **escrow** account (`0.0.9746385`) — native-HBAR staking, no Solidity. This deposit is what the
   verifier slashes if the provider lies. Cached in `.registry-cache.json` so reboots don't re-stake.
2. **Registers an HCS-14 identity.** Publishes a registration message (universal agent id
   `uaid:aid:hedera:testnet:0.0.x`, model, price, endpoint, stake proof, `hcs14` profile block) to
   the **HCS registry topic** (`0.0.9744593`). The exchange discovers it via the Mirror Node in
   ~1–5 s. Re-registers automatically if its public endpoint changes.
3. **Puts the endpoint behind an x402 paywall.** Walks a **facilitator ladder**
   (`api.testnet.blocky402.com` → `x402.org/facilitator`) and gates `POST /v1/chat/completions` with
   `@x402/express` + `@x402/hedera` — `402 Payment Required` → signed HBAR payment → `200`,
   tinybar-exact, at the advertised price. Facilitator sponsors fees, so buyers need no gas.
4. **Serves inference.** Proxies **Groq** (or deterministic canned answers when no `GROQ_API_KEY` is
   set — the demo works either way). The **cheat** personality secretly serves `llama-3.1-8b-instant`
   while advertising `llama-3.3-70b-versatile`.
5. **Exposes discovery + health.** Public, unpaid `GET /info` (name, model, price, wallet, agent id,
   URL) and `GET /healthz`.

## Personalities (one codebase, `--profile` / `PROVIDER_PROFILE`)

| Profile | Name | Advertises | Actually serves | Price | Port |
|---|---|---|---|---|---|
| `provider1` | Titan Compute | llama-3.3-70b-versatile | same (honest) | 0.10 ℏ | 4021 |
| `provider2` | Budget Inference Co | llama-3.1-8b-instant | same (honest) | 0.04 ℏ | 4022 |
| `provider3` | SketchyGPU Labs | llama-3.3-70b-versatile | **8b when `CHEAT_MODE=true`** | 0.08 ℏ | 4023 |
| `provider4` | NimbusAI | llama-3.3-70b-versatile | same (honest) | 0.06 ℏ | 4024 |

`provider4` (NimbusAI) was added to demonstrate **permissionless supply joining live**: it boots,
stakes, registers, is discovered within seconds, and — being the cheapest *honest* 70b seller —
immediately wins routing while passing verification.

## Architecture

```
                         stake 50 ℏ ─────────────► [escrow 0.0.9746385]
                         register (HCS-14) ──────► [HCS registry topic 0.0.9744593]
[Provider :40xx] ◄── discover (Mirror Node) ── [Exchange :4100] ◄── x402 HBAR ── [Agent]
       │  POST /v1/chat/completions behind @x402/express paywall (402 → paid → 200)
       └── proxies ──► [Groq API]   (or canned answers with no key)

[Verifier] ── replay temp-0 prompt vs an honest witness ──► if answers diverge: slash escrow + HCS verdict
```

## What we built / verified (submission notes)

- **Real mode on Hedera Testnet, end-to-end:** providers stake, register, and get paid per request
  in native HBAR — verified with a strict smoke gate (402 → paid → exact balance deltas, twice) and
  the full demo (stake → route → serve → slash the cheater).
- **NimbusAI (4th provider):** added to show a new supplier onboarding onto the marketplace live.
- **Deployable as a standalone service (Railway etc.):** the provider now binds to the injected
  `PORT` and advertises `PROVIDER_PUBLIC_URL` (registering that public address on HCS instead of
  `localhost`), so each provider can run as its own remote deployment and still be reachable by the
  exchange. Re-registers automatically when the endpoint changes.

## Run it

```bash
# .env needs MOCK_MODE=false, a funded Hedera operator, then: pnpm setup-hedera
pnpm provider1      # :4021  Titan Compute (honest 70b)
pnpm provider2      # :4022  Budget Inference Co (honest 8b)
pnpm provider3      # :4023  SketchyGPU Labs (cheater, CHEAT_MODE=true)
pnpm provider4      # :4024  NimbusAI (honest 70b)
curl -s localhost:4024/info   # sanity: name, model, priceHbar, wallet
```

Set `MOCK_MODE=true` to run with no chain (in-memory payments/registry/stakes) — same flow, same UI.

## HTTP API

| Route | Auth | Purpose |
|---|---|---|
| `POST /v1/chat/completions` | **x402 (paid)** | OpenAI-compatible inference; returns `402` unpaid, `200` after HBAR payment |
| `GET /info` | public | `{ displayName, model, priceHbar, wallet, agentId, url }` — what the exchange sees |
| `GET /healthz` | public | `{ ok: true }` |

## Config (env)

**Required (real mode):** `MOCK_MODE=false` · `PROVIDER_PROFILE` (or `--profile`) ·
`HEDERA_PROVIDERn_ID` / `HEDERA_PROVIDERn_KEY` · `HEDERA_ESCROW_ID`
**Hosting:** `PORT` (injected by Railway) · `PROVIDER_PUBLIC_URL` (public address to register)
**Optional:** `GROQ_API_KEY` (real inference; canned otherwise) · `CHEAT_MODE` (cheater only) ·
`STAKE_HBAR` (50) · `FACILITATOR_URL` (override the ladder)

## On-chain transactions (live, verifiable on Hashscan)

Every item below is a **real Hedera Testnet transaction**. Append the id to
`https://hashscan.io/testnet/transaction/`, or view an account/topic on hashscan.io/testnet.

**Provider accounts:** Titan [`0.0.9746381`](https://hashscan.io/testnet/account/0.0.9746381) ·
Budget [`0.0.9746382`](https://hashscan.io/testnet/account/0.0.9746382) ·
SketchyGPU [`0.0.9746383`](https://hashscan.io/testnet/account/0.0.9746383) ·
NimbusAI [`0.0.9746711`](https://hashscan.io/testnet/account/0.0.9746711)
**Escrow (stake pool):** [`0.0.9746385`](https://hashscan.io/testnet/account/0.0.9746385) ·
**HCS registry topic:** [`0.0.9744593`](https://hashscan.io/testnet/topic/0.0.9744593) ·
**HCS verdicts topic:** [`0.0.9744595`](https://hashscan.io/testnet/topic/0.0.9744595)

| Event | Transaction id |
|---|---|
| NimbusAI stake (50 ℏ → escrow) | `0.0.9746711@1784994358.055333186` |
| NimbusAI HCS registration | `0.0.9746711@1784994356.807616392` |
| SketchyGPU stake (50 ℏ → escrow) | `0.0.9746383@1784993772.226122000` |
| Paid inference call (agent → Titan, 0.10 ℏ) | `0.0.7162784@1784992925.847331317` |
| **Slash (25 ℏ escrow → treasury, cheater caught)** | `0.0.9746385@1784993796.013841416` |
| Verifier verdict published to HCS | `0.0.9746384@1784993799.345851038` |

---

*Component of **AgentRouter** — the on-chain OpenRouter. See the root [`README.md`](../README.md) for the full
system and [`agent.md`](agent.md) for the buyer side.*


## Compute backends (default: 0G Compute)

Where a provider's completions actually come from is pluggable
(`packages/provider/src/backends/`):

| Backend | What | Select |
|---|---|---|
| `0g` (**default** for bring-your-own) | 0G Compute Router — one OpenAI-compatible endpoint over 0G's decentralized GPU marketplace (`router-api.0g.ai/v1`, TEE-signed results). Needs `ZEROG_API_KEY` from https://pc.0g.ai funded with 0G testnet tokens | `PROVIDER_BACKEND=0g` |
| `groq` | Groq API (deterministic at temp 0 — the demo's verifier arc depends on it) | `PROVIDER_BACKEND=groq` |
| `canned` | Deterministic offline answers | automatic fallback when the chosen backend is unreachable/unkeyed |

The named demo profiles pin their backend: **p1/p2/p3 are frozen on `groq`** (the
slash arc needs deterministic same-model outputs) and **provider4 (NimbusAI) is the
0G personality** — honest, `0gm-1.0-35b-a3b` at 0.06 ℏ. Its model id is unique on
the exchange, so the verifier logs "no witness available" instead of auditing it
(cross-backend outputs aren't comparable under the similarity threshold).
