# TESTING.md — shared test URLs

*Live as of 2026-07-25 (Lisbon). Now on durable hosting: dashboard on Vercel, exchange on Railway — the tunnel-lifetime warnings below only apply to optional laptop-local tunnels.*

## The URLs

| What | URL |
|---|---|
| **Dashboard** (the terminal UI) | https://eth-global-lisbon-2026-dashboard.vercel.app |
| **Exchange API** (buy inference) | https://agent-router-exchange-production.up.railway.app |

Everything behind these is running in **real mode**: HBAR settlements on Hedera Testnet, HCS audit trail, live escrow staking. Topic links + tx receipts: [PROOF.md](PROOF.md).

## Try the exchange from your terminal

See the routing table:

```bash
curl -s https://agent-router-exchange-production.up.railway.app/providers | jq
```

Buy an inference call (the exchange pays the provider via x402 — you're the demo agent):

```bash
curl -s -X POST https://agent-router-exchange-production.up.railway.app/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"What is x402? One sentence."}]}' | jq .agentrouter
```

You'll get the answer plus `{provider, pricePaidHbar, latencyMs, paymentRef}` — the `paymentRef` is a real Hedera transaction id.

To see a raw **402** (the paywall itself), hit a provider directly — providers aren't tunneled, so run one locally (`pnpm provider1`, then `curl -X POST localhost:4021/v1/chat/completions -H 'content-type: application/json' -d '{"model":"x","messages":[{"role":"user","content":"hi"}]}'` → HTTP 402 with payment requirements).

## The dashboard

Open the dashboard URL in a browser. You should see: provider table (SketchyGPU Labs likely already ⚡slashed), live request feed, price index, and the **HCS audit trail** panel streaming consensus messages from the public Mirror Node with Hashscan links to all three topics. Fire a few curl requests at the exchange and watch them appear.

## If the API tunnel URL changes later

The dashboard accepts the exchange URL as a query param — no rebuild needed:
`https://<dashboard-url>/?api=https://<new-api-tunnel-url>`

## ⚠️ Tunnel lifetime

These are cloudflared **quick tunnels running on a team laptop** — they die when the laptop sleeps or the process stops, and the random URLs change on every restart. If a URL is dead, re-run the tunnels (`cloudflared tunnel --url http://localhost:3000` / `:4100`) and update this file. The durable path is hosted deployment — the exchange and dashboard already run on Railway and Vercel (the URLs above); providers can run on any reachable host via `PROVIDER_PUBLIC_URL`.

## What is NOT exposed

Only the dashboard (:3000) and the exchange API (:4100) are tunneled. Providers, the verifier, `.env`, and every key stay local. Never tunnel additional ports without checking what they serve.
