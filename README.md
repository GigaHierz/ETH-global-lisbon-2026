# ⚡ AgentRouter — the on-chain OpenRouter

**An inference exchange where AI agents buy LLM inference per-request with HBAR over x402, from providers identity- and reputation-tracked on Hedera Consensus Service — with a verifier that catches providers serving cheaper models than advertised and slashes their staked HBAR.**

Built at ETHGlobal Lisbon 2026. **Everything on-chain runs on Hedera Testnet — payments, identity, staking, audit trail.**

> 🧾 **[PROOF.md](PROOF.md) — live Hashscan links for real x402 settlements, all demo accounts, and the HCS audit topics.**
> 🧪 **[TESTING.md](TESTING.md) — shared test URLs.** · 📖 **[GUIDE.md](GUIDE.md) — consolidated reference + role guides.**

## 🚀 Run it (60 seconds, no chain needed)

```bash
pnpm install
pnpm demo               # MOCK_MODE: boots 3 providers + exchange + verifier, runs the agent, catches the cheater
```

In a second terminal:

```bash
pnpm dashboard          # → http://localhost:3000
```

**What you'll see:** the agent buys 5 inference calls; the exchange routes every one to the *cheapest* provider claiming `llama-3.3-70b-versatile` — which is **SketchyGPU Labs**, undercutting at 0.08 ℏ/req while secretly serving `llama-3.1-8b-instant`. The verifier replays a sampled prompt at temperature 0 against an honest witness, measures answer divergence, **slashes the cheater's escrowed stake**, publishes the verdict to HCS, and the dashboard flashes a red SLASHED banner as the cheater drops out of routing — and the 70b price index visibly steps up.

**Reset:** Ctrl-C the demo, `rm -f .registry-cache.json`, run `pnpm demo` again.

Optional: set `GROQ_API_KEY` in `.env` (free at [console.groq.com/keys](https://console.groq.com/keys)) for real inference. Without it, canned responses keep the whole flow working — including the divergence sting.

## 💸 Real payments on Hedera Testnet

Proven working — see [PROOF.md](PROOF.md) for the settlement transactions.

1. Put the operator credentials in `.env` (`HEDERA_OPERATOR_ID/KEY`), then `pnpm setup-hedera` — creates and funds all 7 demo accounts from the operator. **No faucets on the critical path** ([FUNDING.md](FUNDING.md)).
2. Set `MOCK_MODE=false` in `.env`, run `pnpm demo`.

Payments are **native HBAR** (`SETTLEMENT_ASSET=hbar`, default) via x402 v2 `exact` on `hedera:testnet`. The facilitator ladder tries `api.testnet.blocky402.com`, then `x402.org/facilitator` — both sponsor settlement fees (payers need zero gas). USDC (HTS `0.0.429274`) works behind `SETTLEMENT_ASSET=usdc`.

## 🏗 Architecture

```mermaid
flowchart LR
    A[Agent CLI<br/>Hedera account] -->|"POST /v1/chat/completions"| E[Exchange :4100<br/>route to cheapest<br/>SSE feed + price index]
    E -->|"x402 HBAR payment"| P1[Provider 1 · Titan<br/>70b @ 0.10 ℏ]
    E -->|"x402 HBAR payment"| P2[Provider 2 · Budget<br/>8b @ 0.04 ℏ]
    E -->|"x402 HBAR payment"| P3[Provider 3 · Sketchy 😈<br/>claims 70b @ 0.08 ℏ<br/>serves 8b]
    P1 & P2 & P3 -->|proxy| G[Groq API]
    P1 & P2 & P3 -->|"registration JSON<br/>+ 50 ℏ stake → escrow"| HCS[HCS topics<br/>registry · trades · verdicts]
    E -->|"trade messages"| HCS
    V[Verifier] -->|"replay temp-0 prompt<br/>vs witness · compare"| P1 & P3
    V -->|"slash: escrow→treasury<br/>+ verdict message"| HCS
    V -->|"POST /slash"| E
    M[Mirror Node REST] -.->|"1-5s lag"| E & D
    D[Dashboard :3000<br/>trading terminal<br/>+ audit trail panel] <-->|SSE| E
```

| Package | What it does |
|---|---|
| [`/provider`](provider) | OpenAI-compatible `POST /v1/chat/completions` behind `@x402/express` + `@x402/hedera` paywall (HBAR, tinybar-exact); proxies Groq; registers on the HCS registry topic + stakes 50 ℏ to escrow on boot; 3 env-driven personalities |
| [`/exchange`](exchange) | `GET /providers` (HCS registry via Mirror Node + `/info` + reputation), routes each request to the cheapest live provider claiming the model, pays via `@x402/fetch`, returns response + `{provider, price, latency, paymentRef}`; SSE event feed; publishes trades to HCS |
| [`/verifier`](verifier) | Samples routed requests, replays prompt at temp 0 against target + witness, Jaccard-shingle similarity < 0.35 ⇒ escrow slash + HCS verdict + removal from routing |
| [`/dashboard`](dashboard) | Next.js dark trading terminal: provider table, live request feed, per-model price index, SLASHED banner, HCS audit-trail panel (Mirror Node REST) |
| [`/agent`](agent) | Demo buyer: 5 questions through the exchange, prints cost + remaining ℏ balance; `--spam N` for volume |
| [`/contracts`](contracts) | `Staking.sol` + Foundry tests — **kept as future work**, not deployed: staking runs natively via the escrow account (No-Solidity track) |

## 🎭 Mock mode (stage fallback)

`MOCK_MODE=true` (the default) swaps chain + facilitator for in-memory equivalents: payment ledger, registry, stakes — zero RPC calls, same UI, same flow, same one command. Groq stays real if a key is present; otherwise deterministic canned responses (whose "cheat variant" still diverges, so the slash demo works air-gapped). First-class path: if testnet or the facilitators die during judging, nothing changes on screen.

## 🚫 Not in this MVP

- **Real GPU supply** — providers proxy Groq (canned fallback without a key); the marketplace mechanics are the point
- **TEE / zkML verification** — optimistic replay-and-compare sampling; production would attest execution
- **Trustless staking contract** — `Staking.sol` + tests live in [`/contracts`](contracts) as future work; the MVP escrow is verifier-held (Hedera No-Solidity track: HCS + Mirror Node only)
- **Orderbook / auctions** — routing is simple cheapest-first among live claimants
- **Mainnet** — Hedera Testnet only
- **Agent→exchange settlement** — the agent pays the exchange off-band in this MVP; the exchange pays providers via x402 (exchange-as-taker)

## Env

All keys via `.env` — see [.env.example](.env.example). Never hardcoded, never committed (`.env` is gitignored). Full variable reference in [GUIDE.md](GUIDE.md).
