# Jean — BUYER AGENT + VERIFIER

*You don't need to read the codebase. This page is everything.*

## Part 1: the buyer agent

### What it does

[agent/src/index.ts](../agent/src/index.ts) is an autonomous buyer: it sends 5 canned questions through the exchange, pays per request, prints cost + remaining balance after each call.

```bash
pnpm agent                 # 5 questions, one per ~0.8s
pnpm agent --spam 25       # volume mode: 25 requests back-to-back
```

### Env knobs

| Var | Default | Meaning |
|---|---|---|
| `EXCHANGE_URL` | `http://localhost:4100` | where to buy |
| `AGENT_MODEL` | `llama-3.3-70b-versatile` | model to request |
| `AGENT_MOCK_BALANCE_HBAR` | `10` | starting balance in mock mode |
| `HEDERA_AGENT_ID/KEY` | from setup script | the real wallet (real mode) |

Budget enforcement (playbook step 5) will refuse calls once spend exceeds `AGENT_BUDGET_HBAR` — not built yet.

### How the x402 payment actually works

1. Client POSTs to `/v1/chat/completions` with no payment → server replies `402` with payment requirements: `{scheme:"exact", network:"hedera:testnet", amount:"10000000" (tinybars), payTo:"0.0.x", feePayer:"0.0.7162784"}`.
2. The x402 client (`@x402/fetch` + `@x402/hedera`) builds and **signs** a Hedera transfer for exactly that amount, puts it in the `X-PAYMENT` header, retries.
3. The server hands the payment to the **facilitator**, which verifies, **pays the transaction fee itself** (feePayer sponsorship — the buyer needs zero gas), submits, and returns the settle receipt. Server then runs inference and responds `200` + `X-PAYMENT-RESPONSE` header with the tx id.
4. Proof: both settled txs + exact balance deltas in [PROOF.md](../PROOF.md).

### Exchange endpoint contract (what the agent consumes)

`POST /v1/chat/completions` (OpenAI-shaped) → standard completion plus:

```json
"agentrouter": { "provider": "Titan Compute", "pricePaidHbar": 0.10,
                 "latencyMs": 812, "paymentRef": "0.0.7162784@..." }
```

`GET /providers` → the routing table (name, model, priceHbar, stakeHbar, reputation, live).

## Part 2: the verifier

### How sampling works

Every `VERIFY_INTERVAL_MS` (default 15000) the verifier: pulls the exchange's request log, picks an un-audited request, then **replays the same prompt at temperature 0** twice — against the original provider and against a *witness*: another live provider advertising the same model (p3 is always audited against p1, both claiming 70b). It pays both via x402 like any customer — providers can't tell an audit from a sale.

Similarity = Jaccard over word-bigrams ([verifier/src/similarity.ts](../verifier/src/similarity.ts)). Below `SIMILARITY_THRESHOLD` (default **0.35**) ⇒ fraud verdict: slash 25 ℏ from escrow (`SLASH_HBAR`), verdict to HCS, `POST /slash` to the exchange (drops the provider from routing, zeroes reputation).

### Threshold tuning

- Same model at temp 0 → near-identical phrasing → similarity typically **0.6–1.0**
- Different models (70b vs 8b) → measured **0.00–0.07** in our runs
- The 0.35 line sits in the dead zone between those clusters. If Groq nondeterminism ever dips honest pairs near 0.5, lower toward 0.25 before demo day rather than risk a false slash — a false positive (slashing an honest provider) is the worst on-stage outcome.

### Your test matrix

| Scenario | Expected | How to run |
|---|---|---|
| Two honest 70b providers | **never trips** | Set provider3 `CHEAT_MODE=false`, run `pnpm demo`, let the verifier audit repeatedly: every similarity ≥ threshold, no slash over ≥10 audit rounds |
| The cheater | **always trips** | `CHEAT_MODE=true` (default), `pnpm demo`: p3 must be slashed on its first audit, every run |
| No witness available | **skips, never guesses** | Stop provider1; verifier logs `no witness … skipping` and does nothing |
| Canned mode (no GROQ_API_KEY) | same as above | Canned cheat answers are intentionally divergent |

Log lines to grep: `DIVERGENT`, `SLASHED`, `no witness`, `similarity`.
