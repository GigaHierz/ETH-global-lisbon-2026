# @agentrouter/exchange

The routing + settlement core of AgentRouter: an HTTP exchange where buyer agents purchase
LLM inference and the exchange pays the winning provider **per request in HBAR via x402**
on Hedera Testnet. Live deployment: `https://agent-router-exchange-production.up.railway.app`.

## What it does

1. **Discovers supply from the chain.** Providers register themselves on the HCS registry
   topic ([`0.0.9744593`](https://hashscan.io/testnet/topic/0.0.9744593)); the exchange reads
   it via Mirror Node REST (1–5s lag), merges with each provider's live `/info` probe, and
   keeps `PROVIDER_URLS` as a seed/fallback list. Providers registered but unreachable are
   shown as `down` rather than hidden ([discovery.ts](../packages/exchange/src/discovery.ts)).
2. **Routes cheapest-first.** For each `POST /v1/chat/completions`, it filters live,
   un-slashed providers claiming the requested model and picks the lowest `priceHbar`.
3. **Pays via x402.** The exchange wallet signs an exact-amount HBAR transfer answering the
   provider's `402 Payment Required`; the facilitator (ladder: blocky402 → x402.org) verifies,
   sponsors the network fee, and settles on-chain. The settlement tx id is returned to the
   buyer as `paymentRef` ([payer.ts](../packages/exchange/src/payer.ts)).
4. **Publishes every trade to HCS.** One JSON message per paid request to the trades topic
   ([`0.0.9744594`](https://hashscan.io/testnet/topic/0.0.9744594)) — provider, price,
   latency, payment tx. Fire-and-forget; never blocks the response.
5. **Enforces slashes.** The verifier calls `POST /slash`; the provider row is marked
   slashed, its stake display cut, reputation zeroed, and the router skips it from the next
   request onward. The SSE feed broadcasts the event for the dashboard's red banner.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | **The product.** OpenAI-compatible; routes → pays → responds. Response carries `agentrouter: { provider, providerWallet, agentId, pricePaidHbar, latencyMs, paymentRef }` |
| GET | `/providers` | Routing table: name, model, priceHbar, stakeHbar, reputation, status (`live/down/slashed`), HCS-14 agentId |
| GET | `/log?limit=N` | Recent request log (prompt/answer previews, payment refs) |
| GET | `/price-index` | Per-request price points for charting |
| GET | `/events` | SSE stream: `providers`, `request`, `slashed`, `verify` events + snapshot on connect |
| GET | `/topics` | HCS topic ids + Hashscan links (used by the dashboard's audit panel) |
| GET | `/healthz` | Liveness + mock flag |
| POST | `/slash` | Verifier-only: `{ wallet, amountHbar, reason }` → eject from routing |
| POST | `/verify-report` | Verifier audit results → SSE for the dashboard |

## Try it

```bash
curl -s https://agent-router-exchange-production.up.railway.app/providers | jq

curl -s -X POST https://agent-router-exchange-production.up.railway.app/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"What is x402? One sentence."}]}' \
  | jq .agentrouter
```

The `paymentRef` in the response is a real Hedera transaction —
`https://hashscan.io/testnet/transaction/<paymentRef>`.

## Run it

```bash
pnpm exchange                    # mock mode by default (in-memory ledger, no chain)
MOCK_MODE=false pnpm exchange    # real x402 settlement (needs HEDERA_EXCHANGE_ID/KEY in .env)
```

| Env var | Default | Purpose |
|---|---|---|
| `MOCK_MODE` | `true` | in-memory payments/registry when true |
| `HEDERA_EXCHANGE_ID` / `_KEY` | from `pnpm setup-hedera` | the paying wallet (real mode) |
| `FACILITATOR_URL` | ladder | override facilitator rung 1 |
| `PROVIDER_URLS` | 3 localhosts | discovery seed (HCS registry adds the rest) |
| `EXCHANGE_PORT` / `PORT` | `4100` | `PORT` (host-injected, e.g. Railway) wins |
| `HCS_TRADES_TOPIC` etc. | deployments.json | audit-trail topics |

State is **in-memory by design** (hackathon MVP): restart = clean slate; slash status
re-establishes on the verifier's next audit. No DB, no auth.

## Design notes

- **Exchange-as-taker:** the buyer settles with the exchange off-band in this MVP; the
  exchange pays providers with its own wallet. A spread/fee is future work.
- **Everything auditable:** discovery input (registry), every settlement (trades), and
  every enforcement action (verdicts) are on public HCS topics — the whole market can be
  replayed from Mirror Node data. See [PROOF.md](PROOF.md) for live receipts.
- The dashboard front-end for this service lives at
  [`packages/dashboard/app/exchange`](../packages/dashboard/app/exchange/page.tsx) (control-room UI, SSE-driven).
