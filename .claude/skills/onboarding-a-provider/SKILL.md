---
name: onboarding-a-provider
description: Use when a developer wants to run, list, register, or sign up their own inference provider on AgentRouter — sell LLM inference, list my compute/GPU, become a provider, earn HBAR per request, stake and register on Hedera, serve paid x402 completions. Guides and verifies the zero-to-live setup.
---

# Onboarding a Provider

## Overview

Walk a would-be provider from a fresh checkout to a **live, registered, payment-serving provider** on AgentRouter, verifying each step on-chain instead of trusting the logs. A provider is an HTTP server that sells LLM inference: it stakes 50 ℏ, registers an HCS-14 identity on the Hedera Consensus Service, and gets paid per request in HBAR over x402.

**Do the setup WITH the user, one step at a time. After every step, run the verification and show the result before moving on.** Don't dump all the commands at once.

**REQUIRED:** the marketplace side (an exchange, and at least one other provider serving the same model as a verification witness) must be reachable. Locally that's `pnpm exchange` + `pnpm demo`; in production it's the hosted exchange URL.

## The one rule that must never break

**Never print, echo, or paste the value of any private key** (`HEDERA_PROVIDER_KEY`, `HEDERA_OPERATOR_KEY`, etc.). Check that a key is *present*, never what it *is*:

```bash
grep -q '^HEDERA_PROVIDER_KEY=.\+' .env && echo "key present" || echo "MISSING"
```

## Steps (verify each before continuing)

### 1. Prerequisites
- **Node 22+** and **pnpm**: `node -v` (≥22), `pnpm -v`. (On Windows, `pnpm` may be blocked by the PowerShell execution policy — use `pnpm.cmd`.)
- **Repo cloned + installed**: run `pnpm install` in the repo root.
- **A reachable public URL** — a tunnel (`cloudflared tunnel`, `ngrok`) or a VPS/cloud hostname. The exchange routes requests to the address you register, so `localhost` only works if the exchange runs on the same box. Have this URL ready for step 4.

### 2. Hedera account
The provider account stakes, registers, and receives payment. Either:
- Run `pnpm setup-hedera` (needs a funded testnet operator in `.env` from portal.hedera.com) — it writes `HEDERA_PROVIDER_ID`/`HEDERA_PROVIDER_KEY`, or
- Paste an existing testnet account into those two vars.

**Verify (presence only):**
```bash
grep -q '^HEDERA_PROVIDER_ID=0\.0\.' .env && grep -q '^HEDERA_PROVIDER_KEY=.\+' .env && echo "account configured" || echo "run pnpm setup-hedera"
```
If the boot later says `Missing HEDERA_PROVIDER_*`, this step wasn't done.

### 3. Advertise a model + price (backend choice)
Set these in `.env` (the `custom` profile reads them — no code edits):
- `PROVIDER_NAME` — shown in the routing table.
- `PROVIDER_MODEL` — a Groq model id you can serve, e.g. `llama-3.3-70b-versatile`. **You must actually serve what you advertise** (see Guardrails).
- `PROVIDER_PRICE_HBAR` — your price per request. The exchange routes the *cheapest* live provider for a model, so price to win the traffic you want.
- `GROQ_API_KEY` (optional) — real inference from Groq. Omit it and the provider returns deterministic **canned** answers (fine for testing; still serves the advertised model honestly).

### 4. Reachability
Set `PROVIDER_PUBLIC_URL` to your step-1 URL (leave unset only for same-box local testing; it defaults to `http://localhost:<PROVIDER_PORT>`, default port `4025`).

### 5. Boot + stake + register
```bash
pnpm provider          # profile "custom" — reads the vars above
```
On boot it transfers `STAKE_HBAR` (50) to the escrow account and publishes its registration to the HCS registry topic.

**Verify the two on-chain actions from the boot log** — it prints real Hashscan links:
- `staked 50 ℏ → escrow: https://hashscan.io/testnet/transaction/...`
- `registered on HCS registry topic (<your-url>): https://hashscan.io/testnet/transaction/...`

Then confirm the service answers:
```bash
curl -s localhost:4025/healthz     # {"ok":true}
curl -s localhost:4025/info        # displayName, model, priceHbar, wallet, agentId, url
```
`/info.url` MUST be your public URL, not localhost (or the exchange can't reach you).

### 6. Verify it's live and serving paid requests
Mirror Node lag is **1–5 s**, so give discovery a beat, then:

**a. In the exchange routing table** (poll until it appears, `status: "live"`):
```bash
curl -s <EXCHANGE_URL>/providers | grep '"displayName":"<PROVIDER_NAME>"'
```

**b. The paywall rejects unpaid requests** (proves x402 is armed):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4025/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"<PROVIDER_MODEL>","messages":[{"role":"user","content":"hi"}]}'
# expect: 402
```

**c. A real paid request completes end-to-end** — route through the exchange (it signs the x402 HBAR payment). If you're the cheapest live provider for the model, it routes to you:
```bash
curl -s -X POST <EXCHANGE_URL>/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"<PROVIDER_MODEL>","messages":[{"role":"user","content":"Capital of France in one word."}]}' \
  | grep -o '"agentrouter":{[^}]*}'
# expect: "provider":"<PROVIDER_NAME>", a "paymentRef" tx id, and pricePaidHbar == your price
```
Seeing your name + a `paymentRef` here is the acceptance bar: **402 → paid → completion**, settled on-chain.

## Play-fair guardrails (avoid getting slashed)

The verifier samples routed requests, replays the prompt at temperature 0 against your provider **and a witness** claiming the same model, and compares. If the answers diverge (Jaccard similarity `< SIMILARITY_THRESHOLD`, default 0.35), it seizes your **50 ℏ stake to the treasury and ejects you from routing**.

- **Serve exactly what you advertise.** The `custom` profile sets `actualModel = advertisedModel`, so honest by construction — don't defeat that by proxying a cheaper model.
- **You're only audited when a witness exists** — another live provider serving the same `PROVIDER_MODEL`. Advertising a model nobody else serves means no verification *and* likely no comparison-based trust; pick a model the market already has.
- **Keep your endpoint reachable.** A provider that goes unreachable is marked `down` and dropped from routing (not slashed), but it earns nothing.

## Quick reference

| Var | Default | Purpose |
|---|---|---|
| `PROVIDER_NAME` | Custom Provider | Display name in the routing table |
| `PROVIDER_MODEL` | llama-3.3-70b-versatile | Model you advertise **and serve** |
| `PROVIDER_PRICE_HBAR` | 0.10 | Your price per request (cheapest wins routing) |
| `PROVIDER_PORT` | 4025 | Local listen port |
| `PROVIDER_PUBLIC_URL` | localhost:\<port\> | Address the exchange routes to (tunnel/VPS) |
| `HEDERA_PROVIDER_ID` / `_KEY` | from `pnpm setup-hedera` | Account that stakes, registers, earns |
| `GROQ_API_KEY` | — | Real inference; omit → canned answers |
| `STAKE_HBAR` | 50 | Boot-time stake to escrow |

## Common mistakes

| Symptom | Cause / fix |
|---|---|
| Exchange never shows the provider | Mirror lag (wait 1–5 s); `/healthz` down; `PROVIDER_PUBLIC_URL` is `localhost` but the exchange is on another box |
| Boot: `Missing HEDERA_PROVIDER_*` | Step 2 not done — `pnpm setup-hedera` or paste the account into `.env` |
| Paid request routes to someone else | You're not the cheapest live provider for that model — lower `PROVIDER_PRICE_HBAR` |
| Registered but never audited | No witness — no other live provider serves your `PROVIDER_MODEL` |
| Nothing settles / 402 loops | `MOCK_MODE` must be `false` for real payments; the facilitator ladder must be reachable |
