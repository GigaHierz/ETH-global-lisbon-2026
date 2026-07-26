# AgentRouter Exchange — the protocol, end to end

**AgentRouter is a spot market where AI agents buy LLM inference per-request with USDC, from
providers whose identity, stakes, trades, and fraud verdicts all live on Hedera public
infrastructure.** This package is the exchange — the router and settlement engine at the
center of it. This README explains everything the protocol does, not just this service.

**Live right now:**

| Surface | URL |
|---|---|
| Landing (protocol overview) | https://eth-global-lisbon-2026-dashboard.vercel.app |
| Exchange terminal (this service's UI) | https://eth-global-lisbon-2026-dashboard.vercel.app/exchange |
| Agent demo (autonomous buyer) | https://eth-global-lisbon-2026-dashboard.vercel.app/agent-demo |
| Exchange API (this service, Railway) | https://exchange-production-275a.up.railway.app |
| On-chain receipts | [PROOF.md](PROOF.md) |

---

## 1 · The problem

When you call an LLM API today, you *trust* the provider runs the model you paid for.
There is no verification. As AI agents become autonomous buyers — choosing providers,
paying per request, no human in the loop — that trust gap becomes an attack surface:
advertise a 70B model, secretly serve a cheap 8B, pocket the margin, undercut every honest
competitor on price. **In a naive marketplace, the cheapest fraud wins all the routing.**

AgentRouter closes the loop economically: providers post a stake, a verifier catches
model fraud by replaying prompts, and cheaters lose their stake and their place in the
market — publicly, on-chain, with the whole history replayable from Hedera Mirror Node.

## 2 · The three actors

### Providers (supply)
Anyone with a box sells inference. On boot, a provider:
1. **Stakes 50 ℏ** (`STAKE_HBAR`) — a native HBAR transfer to the escrow account
   [`0.0.9744157`](https://hashscan.io/testnet/account/0.0.9744157). No contract; the
   transfer *is* the bond (Hedera No-Solidity design).
2. **Registers on the HCS registry topic**
   [`0.0.9744593`](https://hashscan.io/testnet/topic/0.0.9744593) with an HCS-14-style
   universal agent id (`uaid:aid:hedera:testnet:0.0.x`), advertised model, price, and its
   public endpoint:

```json
{ "type": "registration",
  "agentId": "uaid:aid:hedera:testnet:0.0.9744152",
  "account": "0.0.9744152",
  "displayName": "Titan Compute",
  "model": "llama-3.3-70b-versatile",
  "price": 0.1,
  "asset": "USDC",
  "endpoint": "https://titan.example.com",
  "stakeHbar": 50,
  "stakeTx": "0.0.9744152@1784983507.494541568",
  "hcs14": { "uaid": "…", "profile": "data:application/json,…" } }
```

3. **Serves an OpenAI-compatible endpoint** (`POST /v1/chat/completions`) behind an x402
   paywall. Unpaid requests get `402 Payment Required` with machine-readable payment
   requirements; paid requests get inference. Backends: Groq API, or a
   canned deterministic fallback (so demos survive with zero external dependencies).

There is **no signup and no permission** — the stake is the listing fee, the topic message
is the listing, being reachable is the activation. The exchange discovers new supply from
the chain within seconds.

### Agents (demand)
Any wallet-holding process can buy. The demo agent
([/agent-demo](https://eth-global-lisbon-2026-dashboard.vercel.app/agent-demo)) is a full
autonomous buyer: give it a goal, it plans sub-questions, **buys each answer through the
exchange with a real HBAR payment**, tracks a hard budget cap (stops buying when
exhausted), and synthesizes a final answer — every purchase individually settled on-chain
with a clickable Hashscan receipt. Its identity is an HCS-14 UAID like the providers'.

### The verifier (enforcement)
Every `VERIFY_INTERVAL_MS` (15s) the verifier samples a past routed request and replays the
same prompt at **temperature 0** against two parties: the provider that served it, and a
*witness* — another live provider advertising the same model. It pays both via x402 like
any customer, so **audits are indistinguishable from sales**. It compares answers with
Jaccard similarity over word bigrams:

- Same model at temp 0 → near-identical output → similarity typically **0.6–1.0**
- Different models (8B posing as 70B) → measured **0.00–0.10** in production
- Threshold: **0.35**, sitting in the dead zone between the clusters

Below threshold ⇒ fraud verdict: **25 ℏ moved escrow→treasury** (a native transfer signed
with the verifier-held escrow key), a verdict message on HCS, and a `POST /slash` to the
exchange that ejects the provider from routing and zeroes its reputation. This has run for
real — see the receipts in §7.

## 3 · How a payment actually settles (x402 on Hedera)

1. Buyer POSTs to a paid endpoint with no payment → **HTTP 402** with x402 v2 payment
   requirements: `{ scheme: "exact", network: "hedera:testnet", amount: "10000000"
   (tinybars), payTo: "0.0.9744152", extra: { feePayer: "0.0.7162784" } }`.
2. The buyer's x402 client (`@x402/fetch` + `@x402/hedera`) builds and **signs** a Hedera
   `TransferTransaction` for exactly that amount and retries the request with the signed
   payment in the `X-PAYMENT` header.
3. The server forwards it to the **facilitator**, which verifies the signature, **pays the
   network fee itself** (feePayer sponsorship — buyers need zero gas, their balance moves by
   the price and only the price), submits to consensus, and returns the settle receipt.
4. The server runs inference and responds `200` with the answer plus the settlement
   transaction id. Whole loop ≈ 2 seconds.

The facilitator is **boot-time verified over a ladder**: `api.testnet.blocky402.com` →
`x402.org/facilitator` — services probe `/supported` and log which rung answered; if one
dies the next takes over, and `MOCK_MODE=true` keeps the entire system demoable offline.
Settlement asset is native HBAR (tinybar-exact).

## 4 · What THIS service does (the exchange)

The exchange is the market maker between the two sides — an Express service
([src/index.ts](../packages/exchange/src/index.ts)) with four jobs:

1. **Discovery from the chain** ([src/discovery.ts](../packages/exchange/src/discovery.ts)): polls the HCS
   registry topic via Mirror Node REST (1–5s consensus lag), merges each registration with
   a live `/info`+`/healthz` probe of the registered endpoint, seeds from `PROVIDER_URLS`
   as fallback. Registered-but-unreachable providers appear as `down` (never silently
   hidden) — if you register `localhost` from a remote box, you'll see yourself down until
   you set `PROVIDER_PUBLIC_URL`.
2. **Cheapest-first routing**: filter live, un-slashed providers claiming the requested
   model; sort by price; take the head. When the cheapest claimant is a fraud, it wins all
   the traffic — until the verifier catches it. That's deliberate: it's the demo's plot.
3. **Payment** ([src/payer.ts](../packages/exchange/src/payer.ts)): the exchange holds its own wallet
   (`HEDERA_EXCHANGE_ID/KEY`) and answers each provider's 402 with a signed exact-amount
   transfer (§3). Exchange-as-taker model: the buyer settles with the exchange off-band in
   this MVP; a per-request spread is the obvious future revenue line.
4. **Transparency**: every successful trade is published to the HCS trades topic
   [`0.0.9744594`](https://hashscan.io/testnet/topic/0.0.9744594) (fire-and-forget, never
   blocks the response), and every state change streams over SSE to the dashboard:

```json
{ "type": "trade", "model": "llama-3.3-70b-versatile", "provider": "SketchyGPU Labs",
  "providerAccount": "0.0.9744154", "price": 0.08, "latencyMs": 2472,
  "paymentTx": "0.0.7162784@1785006818.184321763", "ts": 1785006823823 }
```

### API reference

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | **The product.** OpenAI-shaped request in; routed, paid, answered. Response adds `agentrouter: { provider, providerWallet, agentId, pricePaid, latencyMs, paymentRef }` — `paymentRef` is a real Hedera tx id |
| GET | `/providers` | Routing table: displayName, model, price, stakeHbar, reputation, status `live/down/slashed`, HCS-14 agentId, wallet |
| GET | `/log?limit=N` | Recent request log with prompt/answer previews + payment refs |
| GET | `/price-index` | Price points per settled request (the dashboard's chart series) |
| GET | `/events` | SSE: `providers` (table refresh), `request` (each trade), `slashed` (banner), `verify` (audit results); snapshot on connect |
| GET | `/topics` | The three HCS topic ids + Hashscan links (the dashboard audit panel bootstraps from this, then reads Mirror Node directly) |
| GET | `/healthz` | `{ ok, mock }` |
| POST | `/slash` | Verifier-only: `{ wallet, amountHbar, reason }` → stake display cut, reputation → 0, ejected from routing, SSE `slashed` broadcast |
| POST | `/verify-report` | Verifier audit results (similarity, verdict) → SSE for the dashboard's audit log |

### Try it against production

```bash
curl -s https://exchange-production-275a.up.railway.app/providers | jq

curl -s -X POST https://exchange-production-275a.up.railway.app/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"What is x402? One sentence."}]}' \
  | jq .agentrouter
```

Take the `paymentRef` from the response and open
`https://hashscan.io/testnet/transaction/<paymentRef>` — that's your purchase, settled.

## 5 · The web app (what each page shows)

All three pages share one design system (obsidian/cyan/orange HUD, JetBrains Mono data
surfaces) and accept `?api=<url>` to point at any backend without rebuilding.

- **/** — the protocol landing: live stats pulled from this exchange (volume, requests,
  providers live, avg price), a scrolling "Network Integrity" marquee of six real Hashscan
  receipts, the three-actor architecture, and provider onboarding (the real five commands +
  a provider waitlist CTA).
- **/exchange** — the market control room, driven by this service's SSE stream: provider
  registry (with Hashscan account links and slashed-row treatment), price index chart
  (watch it step up when fraud exits), verifier audit log (PASS / FRAUD cards with
  similarity scores), a **tabbed HCS audit trail reading Mirror Node directly** (registry /
  trades / verdicts with raw consensus JSON), the live settlement feed with per-trade tx
  links, and the striped red SLASHED alert banner.
- **/agent-demo** — the buyer's cockpit: HCS-14 identity card, wallet balance + budget bar
  (cyan → orange → red as spend approaches the cap), a mission-control goal input, and the
  live reasoning stream — plan, each purchased answer with its payment receipt, synthesis.

## 6 · Running it yourself

```bash
pnpm install
pnpm exchange                    # MOCK_MODE=true: in-memory ledger/registry, no chain
MOCK_MODE=false pnpm exchange    # real x402 + HCS (needs .env, see below)
```

| Env var | Default | Purpose |
|---|---|---|
| `MOCK_MODE` | `true` | in-memory payments/registry/stakes when true — first-class stage fallback, same API |
| `HEDERA_EXCHANGE_ID` / `_KEY` | via `pnpm setup-hedera` | the paying wallet |
| `FACILITATOR_URL` | ladder | override facilitator rung 1 |
| `PROVIDER_URLS` | 3 localhosts | discovery seed; HCS registry adds everything else |
| `EXCHANGE_PORT` / `PORT` | `4100` | host-injected `PORT` (Railway) wins |
| `HCS_REGISTRY/TRADES/VERDICTS_TOPIC` | deployments.json | audit-trail topics |

Full-system demo: `pnpm demo` (3 providers + exchange + verifier + agent, narrated,
catches the cheater live). Account/topic bootstrap: `pnpm setup-hedera`, `pnpm setup-hcs`
(operator key required — [FUNDING.md](FUNDING.md)). Deployment: `Dockerfile` +
`railway.json` at the repo root.

State is **in-memory by design** (no DB, no auth — hackathon MVP). Restart = clean table;
slash status re-establishes on the verifier's next audit because the *stake and verdicts
live on-chain*, not in this process.

## 7 · Receipts (everything above happened for real)

| Event | Link |
|---|---|
| x402 settlement, agent → provider (exact 0.1 ℏ both sides, fee-sponsored) | [tx](https://hashscan.io/testnet/transaction/0.0.7162784@1784982277.193217949) |
| Second consecutive settlement (gate: twice in a row) | [tx](https://hashscan.io/testnet/transaction/0.0.7162784@1784982283.158991431) |
| Provider stakes 50 ℏ → escrow (×3, one per provider) | [tx](https://hashscan.io/testnet/transaction/0.0.9744152@1784983507.494541568) |
| **Slash: 25 ℏ escrow → treasury** (SketchyGPU caught at 10% similarity) | [tx](https://hashscan.io/testnet/transaction/0.0.9744157@1784983556.547115247) |
| Registry topic (all registrations) | [0.0.9744593](https://hashscan.io/testnet/topic/0.0.9744593) |
| Trades topic (one message per paid request) | [0.0.9744594](https://hashscan.io/testnet/topic/0.0.9744594) |
| Verdicts topic (fraud verdict, seq 1 onward) | [0.0.9744595](https://hashscan.io/testnet/topic/0.0.9744595) |

Anyone can replay the entire market — who listed, every trade, every enforcement action —
from public Mirror Node data. That is the point.

## 8 · Honest limits (current scope)

- **Verifier is trusted** — it holds the escrow key and is the sole slash authority.
- **Optimistic sampling** — verification is replay-and-compare, which a cheater could game
  by fingerprinting audit traffic or only cheating on long prompts.
- **Exchange-as-taker** — the agent pays the exchange over x402 (provider price + a 10%
  taker fee, `EXCHANGE_FEE_BPS`); the provider always receives exactly its listed price.
- **In-memory exchange state**, cheapest-first routing, Hedera Testnet only.

Hardening and decentralization of the above are tracked as
[open issues](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues).

## Fee accrual & the dynamic 402 quote flow

```
agent                exchange                      provider
  │  POST (unpaid)      │                             │
  │────────────────────▶│ route model → cheapest      │
  │                     │ quote: price+fee (pinned 60s)│
  │  402 {total, quoteId}│                            │
  │◀────────────────────│                             │
  │  POST + X-PAYMENT   │ verify (pinned quote)       │
  │────────────────────▶│──── x402 pay price ────────▶│
  │                     │◀──── completion ────────────│
  │  200 + receipt      │ settle inbound (afterSettle:│
  │◀────────────────────│  accrue fee, HCS w/ both tx)│
```

- Fee math is integer tinybars: `fee = ceil(price × EXCHANGE_FEE_BPS / 10000)` — rounded UP
  so the exchange never underquotes. Floats only at the display edge.
- Quote pinning keys on a hash of `{model, messages}` — the retry recomputes the identical
  pinned amount, so the signed payment verifies even if the market moved. TTL 60s.
- Provider failure → the agent's verified payment is canceled (real mode, never charged)
  or refunded with memo `refund:<quoteId>` (`REFUND_ON_FAILURE`, default true).
- Fee revenue accrues only on settled inbound payments (`onAfterSettle`) — `GET /stats`
  serves `{ totalVolume, requests, feeRevenue, refunds, refundFailures, feeBps, asset }`.
- HCS trade messages carry `price`, `fee`, `total`, `asset` and both settlement txs.
