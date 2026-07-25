# TESTING.md — shared test URLs

*Live as of 2026-07-25 (Lisbon). Quick tunnels — see the warning at the bottom.*

## The URLs

| What | URL |
|---|---|
| **Dashboard** (the terminal UI) | https://holders-independent-amazing-text.trycloudflare.com |
| **Exchange API** (buy inference) | https://posters-gordon-revised-payment.trycloudflare.com |

Everything behind these is running in **real mode**: HBAR settlements on Hedera Testnet, HCS audit trail, live escrow staking. Topic links + tx receipts: [PROOF.md](PROOF.md).

## Try the exchange from your terminal

See the routing table:

```bash
curl -s https://posters-gordon-revised-payment.trycloudflare.com/providers | jq
```

Buy an inference call (the exchange pays the provider via x402 — you're the demo agent):

```bash
curl -s -X POST https://posters-gordon-revised-payment.trycloudflare.com/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"What is x402? One sentence."}]}' | jq .agentrouter
```

You'll get the answer plus `{provider, pricePaidHbar, latencyMs, paymentRef}` — the `paymentRef` is a real Hedera transaction id.

To see a raw **402** (the paywall itself), hit a provider directly — providers aren't tunneled, so run one locally (`pnpm provider1`, then `curl -X POST localhost:4021/v1/chat/completions -H 'content-type: application/json' -d '{"model":"x","messages":[{"role":"user","content":"hi"}]}'` → HTTP 402 with payment requirements).

## The dashboard

Open the dashboard URL in a browser. You should see: provider table (SketchyGPU Labs likely already ⚡slashed), live request feed, price index, and the **HCS audit trail** panel streaming consensus messages from the public Mirror Node with Hashscan links to all three topics. Fire a few curl requests at the exchange and watch them appear.

## ⚠️ Tunnel lifetime

These are cloudflared **quick tunnels running on Sahil's laptop** — they die when the laptop sleeps or the process stops, and the random URLs change on every restart. If a URL is dead, ping Sahil to re-run the tunnels (`cloudflared tunnel --url http://localhost:3000` / `:4100`) and update this file. **A VPS is the durable home** — when VPS SSH details land in `.env` (`VPS_HOST/VPS_USER/VPS_KEY_PATH`), a `scripts/deploy-vps.sh` (rsync + pm2) replaces this section with stable URLs.

## What is NOT exposed

Only the dashboard (:3000) and the exchange API (:4100) are tunneled. Providers, the verifier, `.env`, and every key stay local. Never tunnel additional ports without checking what they serve.
