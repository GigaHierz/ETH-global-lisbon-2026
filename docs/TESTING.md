# TESTING.md — shared test URLs

*Live as of 2026-07-25 (Lisbon). Now on durable hosting: dashboard on Vercel, exchange on Railway — the tunnel-lifetime warnings below only apply to optional laptop-local tunnels.*

## The URLs

| What | URL |
|---|---|
| **Dashboard** (the terminal UI) | https://eth-global-lisbon-2026-dashboard.vercel.app |
| **Exchange API** (buy inference) | https://exchange-production-275a.up.railway.app |
| **Agent server** (autonomous buyer) | https://agent-server-production-6029.up.railway.app |
| **Provider 1** — Titan, honest 70B @ 0.10 | https://provider1-production.up.railway.app |
| **Provider 2** — Budget, honest 8B @ 0.04 | https://provider2-production.up.railway.app |
| **Provider 3** — SketchyGPU, **the cheater** @ 0.08 | https://provider3-production.up.railway.app |

Everything behind these is running in **real mode**: USDC settlements on Hedera Testnet, HCS audit trail, live escrow staking. Topic links + tx receipts: [PROOF.md](PROOF.md).

## Try the exchange from your terminal

See the routing table:

```bash
curl -s https://exchange-production-275a.up.railway.app/providers | jq
```

Buy an inference call (the exchange pays the provider via x402 — you're the demo agent):

```bash
curl -s -X POST https://exchange-production-275a.up.railway.app/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"What is x402? One sentence."}]}' | jq .agentrouter
```

You'll get the answer plus `{provider, price, fee, total, asset, latencyMs, paymentRef}` — the `paymentRef` is a real Hedera transaction id.

## See the paywall itself — a real HTTP 402

The providers are publicly deployed too, so you can hit the x402 paywall directly with no local
setup. It answers **HTTP 402** with the payment requirements base64-encoded in the
`payment-required` header:

```bash
curl -si -X POST https://provider1-production.up.railway.app/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}]}' \
  | grep -i '^payment-required' | cut -d' ' -f2 | base64 -d | jq
```

Decoded, that is the live x402 v2 challenge:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "description": "Titan Compute — llama-3.3-70b-versatile inference" },
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "100000",
    "asset": "0.0.429274",
    "payTo": "0.0.9755663",
    "maxTimeoutSeconds": 300,
    "extra": { "feePayer": "0.0.7162784" }
  }]
}
```

Everything needed to verify the payment story is in that one response: scheme `exact` on
`hedera:testnet`, `100000` base units (= 0.10 USDC at 6 decimals) of `asset 0.0.429274`
(**HTS USDC**, not HBAR), paid to provider1's real account `0.0.9755663`, with the facilitator
`0.0.7162784` as `feePayer` — which is why the payer needs zero gas.

The other two providers answer the same way with their own prices and accounts —
`provider2-production` (honest 8B, 0.04) and `provider3-production` (**the cheater**,
advertises 70B and serves 8B, undercutting Titan at 0.08).

## The dashboard

Open the dashboard URL in a browser. You should see: provider table (SketchyGPU Labs likely already ⚡slashed), live request feed, price index, and the **HCS audit trail** panel streaming consensus messages from the public Mirror Node with Hashscan links to all three topics. Fire a few curl requests at the exchange and watch them appear.

## If the API tunnel URL changes later

The dashboard accepts the exchange URL as a query param — no rebuild needed:
`https://<dashboard-url>/?api=https://<new-api-tunnel-url>`

## Hosting

Every URL above is a **durable production deployment**, not a laptop tunnel: the dashboard on
Vercel, the backends on Railway, each auto-deploying from `main`. They stay up independently of
anyone's machine. Per-service configuration and the demo runbook are in [DEPLOY.md](DEPLOY.md).

If you do run a provider from your own box behind a tunnel, the address it registers on HCS
comes from `PROVIDER_PUBLIC_URL` — see
[provider.md § Listing your own compute](provider.md#listing-your-own-compute).

## What is NOT exposed

The dashboard, the exchange, the agent server and the three providers are public. The
**verifier** is an outbound-only worker with no public domain — it is observable only through
its effects: the verdicts topic, the slash transfers, and the ARBOND wipe. The `.env` file and
every private key stay local.
