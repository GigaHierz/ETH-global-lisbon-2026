# AgentRouter — Autonomous Buyer Agent

An AI agent with its own Hedera wallet that **buys LLM inference per request and pays for it
autonomously in real HBAR** on Hedera Testnet, over the [x402](https://x402.org) protocol.
It has an on-chain **HCS-14 identity**, reasons toward a goal with a budget it can't exceed,
and streams every step (plan → paid buys → synthesis) to a live web UI.

Built on the **[Hedera Agent Kit](https://github.com/hedera-dev/hedera-agent-kit)** (identity /
on-chain actions) + the **Hedera SDK** + **x402**. Everything on-chain is real testnet — no mocks.

## What it does

1. **Registers an HCS-14 identity** (`uaid:aid:hedera:testnet:0.0.9746264`) to the shared HCS
   registry topic — submitted via the Hedera Agent Kit's `submit_topic_message_tool`. Same
   directory the providers register into, so buyers and sellers are one discoverable set.
2. **Plans** a goal into sub-questions (Groq brain — the agent's own reasoning).
3. **Buys** an answer to each question through the exchange, **signing the x402 HBAR payment with
   its own AGENT account** (the exchange routes to the cheapest live provider and keeps the spread).
4. **Enforces a budget** (`AGENT_BUDGET_HBAR`) — stops buying the moment the next call won't fit.
5. **Synthesizes** the bought answers into a final result.
6. **Streams** identity, balance, budget, and every paid step (with Hashscan links) over SSE to
   the `/agent` web page.

```
[web UI /agent] --SSE--> [agent-server :4200] --x402 HBAR (AGENT-signed)--> [exchange :4100] --x402--> cheapest provider --> Groq
                              |__ Hedera Agent Kit: HCS-14 identity registration
```

## Run it

Each terminal first: `export PATH="$HOME/.nvm/versions/node/v22.17.1/bin:$PATH"` (repo needs Node 22).
`.env` must have `MOCK_MODE=false`, a Hedera operator, and `GROQ_API_KEY`, then `pnpm setup-hedera`.

```bash
pnpm exchange         # :4100  (marketplace + x402 paywall)
pnpm provider1        # :4021  (or your provider fleet)
pnpm agent-server     # :4200  (this agent)
pnpm dashboard        # http://localhost:3000/agent
```

Then open `http://localhost:3000/agent`, enter a goal, and watch it buy.

### HTTP API (agent-server)
| Route | Purpose |
|---|---|
| `POST /run` `{goal}` | start a budget-capped reasoning run |
| `GET /events` | SSE stream: `goal` · `plan` · `bought` (+Hashscan) · `synthesis` · `done` · `balance` |
| `GET /identity` | the agent's HCS-14 UAID + registration tx |
| `GET /state` | snapshot (balance, budget, findings, events) |

### Config
`EXCHANGE_ASK_HBAR` (0.12) · `AGENT_BUDGET_HBAR` (2) · `AGENT_PORT` (4200) ·
`AGENT_MODEL` (llama-3.3-70b-versatile) · `AGENT_MAX_QUESTIONS` (3) · `AGENT_BRAIN_MODEL`.

## On-chain transactions (live, verifiable on Hashscan)

Every transaction below is a **real Hedera Testnet transaction** produced by this agent.

**Agent account (full ledger):** [`0.0.9746264`](https://hashscan.io/testnet/account/0.0.9746264)
**HCS registry topic (identity + discovery):** [`0.0.9744593`](https://hashscan.io/testnet/topic/0.0.9744593)

| # | Action | Type | Transaction |
|---|--------|------|-------------|
| 1 | Agent account created (funded from operator) | `CryptoCreateAccount` | [`0.0.9700468-1784992006-378231401`](https://hashscan.io/testnet/transaction/0.0.9700468-1784992006-378231401) |
| 2 | **HCS-14 identity registered via Hedera Agent Kit** | `ConsensusSubmitMessage` | [`0.0.9746264-1784995791-428040902`](https://hashscan.io/testnet/transaction/0.0.9746264-1784995791-428040902) |
| 3 | **x402 inference buy #1** (agent → exchange, 0.12 ℏ) | `CryptoTransfer` | [`0.0.7162784-1784995803-350643565`](https://hashscan.io/testnet/transaction/0.0.7162784-1784995803-350643565) |
| 4 | **x402 inference buy #2** (agent → exchange, 0.12 ℏ) | `CryptoTransfer` | [`0.0.7162784-1784995807-392888972`](https://hashscan.io/testnet/transaction/0.0.7162784-1784995807-392888972) |

> x402 settlements are submitted by the facilitator's fee-payer (`0.0.7162784`, which sponsors the
> network fee) and move HBAR **from the agent (`0.0.9746264`) to the exchange** — open any of the
> `CryptoTransfer` links to see the transfer list. The agent account page shows the running balance
> draining with each purchase.

**Demo accounts:** AGENT `0.0.9746264` · EXCHANGE `0.0.9746267` · PROVIDER1/2/3 `0.0.9746268/70/71` ·
VERIFIER `0.0.9746272` · ESCROW `0.0.9746274`.

For the newest transactions at any time, refresh the [agent account page](https://hashscan.io/testnet/account/0.0.9746264).

## Code map
| File | What |
|---|---|
| `src/identity.ts` | HCS-14 UAID + Agent-Kit registration |
| `src/brain.ts` | Groq planner / synthesizer |
| `src/loop.ts` | plan → paid buys → synthesize, budget-aware (unit-tested) |
| `src/budget.ts` | spend-cap enforcement (unit-tested) |
| `src/buy.ts` | exchange-response → `BuyResult`, x402 wiring (unit-tested) |
| `src/payer.ts` | AGENT-signed x402 paying client |
| `src/server.ts` | Express + SSE agent-server |

## Tests
```bash
export PATH="$HOME/.nvm/versions/node/v22.17.1/bin:$PATH"
pnpm --filter @agentrouter/agent test    # budget, loop, buy, identity — 17 tests
```


## Fees: the agent pays price + fee

Every purchase costs `provider price + exchange fee` (10% taker-side, ceil-rounded in
tinybars). The CLI prints `price 0.08 + fee 0.008 = 0.088 ℏ` per call with running spend,
and the budget cap is enforced against the TOTAL, not the provider price. The mock payer
mirrors the real x402 client: it reads the dynamic 402 quote and pays the exact total.
