# @agentrouter/verifier

The fraud auditor of AgentRouter: an autonomous agent that catches providers serving a
cheaper model than they advertise and **slashes their staked HBAR**. It has its own Hedera
account and HCS-14 identity, watches the exchange, and enforces quality without trusting any
provider's self-report.

## What it does

1. **Samples routed traffic.** On a fixed cadence (`VERIFY_INTERVAL_MS`, default 15s) it reads
   the exchange request log and picks an audit candidate — a real buyer request served by a
   provider, never one of its own replays ([audit-selection.ts](../packages/verifier/src/audit-selection.ts)).
   The selection rules are deterministic and spelled out [below](#how-a-candidate-is-chosen).
2. **Replays against a witness.** It re-issues the sampled prompt at **temperature 0** to both
   the accused provider and an honest witness provider serving the same advertised model, so
   two faithful servers of the same model should return near-identical text
   ([verification.ts](../packages/verifier/src/verification.ts)).
3. **Measures divergence.** It scores answer similarity with a unicode-safe bigram-Jaccard
   shingle metric. At or above the threshold (`SIMILARITY_THRESHOLD`, default **0.35**) the
   provider **passes**; below it, **diverges** (fraud); empty/one-word answers are
   **inconclusive** ([similarity.ts](../packages/verifier/src/similarity.ts)).
4. **Slashes on-chain (No-Solidity).** On a fraud verdict it moves `SLASH_HBAR` (default 25 ℏ)
   from the verifier-held escrow account to the treasury via a native `TransferTransaction`
   — no smart contract — then publishes the verdict to the HCS verdicts topic
   ([`0.0.9744595`](https://hashscan.io/testnet/topic/0.0.9744595)) and calls the exchange's
   `POST /slash` so the cheater is removed from routing. Each wallet is claimed before the
   awaits, so a provider can't be double-slashed.

## How a candidate is chosen

Selection is a pure function of the request log, the provider table, and the ids/wallets this
verifier already handled — same inputs, same choice, no randomness
([audit-selection.ts](../packages/verifier/src/audit-selection.ts)).

**The request** is the newest eligible one (ties broken by request id, so the log's arrival
order cannot change the pick). A request is eligible only when it succeeded, is not already
audited, is not flagged `isAudit`, and its provider is still known, live, unslashed, and still
advertising the model the request was routed on. A provider that has since changed its
advertised model is skipped — judging it on a model it no longer claims would be meaningless.

**The accused** is resolved by provider URL — the exchange's own key for its provider table —
not by display name, so two providers sharing a name cannot be confused for one another.

**The witness** must be live, unslashed, advertising the *exact* same model, and be neither the
accused's URL nor its payout account (a second endpoint behind one wallet cannot testify for
itself). Among the eligible witnesses the cheapest is chosen, ties broken by URL.

**No witness ⇒ skipped, never divergent.** The scan then continues to older candidates rather
than stalling, and the witness-less request is left unaudited so it becomes auditable the
moment a second provider for that model appears.

**Coverage bound:** each tick reads `VERIFY_LOG_LIMIT` entries (default: the exchange's whole
in-memory buffer). If that page comes back full the verifier logs that the window is saturated,
so "no eligible request" is never confused with "nothing older exists".

## How verification stays honest

- **Temperature 0** makes an honest model near-deterministic, so a real divergence signals a
  different (cheaper) model, not sampling noise.
- **Same-model witness** is the control: the accused is only faulted when it diverges from a
  provider serving the *same advertised* model.
- **Audits cannot audit themselves.** Replays go straight to the provider, bypassing the
  exchange, so they never enter the request log and can never be sampled later. They also carry
  **no audit marker**, deliberately: a marker would let a provider recognise an audit and serve
  the honest model only while being watched. (Traffic *routed through* the exchange under the
  `x-agentrouter-audit` header is still tagged `isAudit` and filtered out — defence in depth for
  a path the verifier does not currently use.)
- **Only divergence enforces.** Timeouts, transport failures, non-2xx replies, malformed or
  empty bodies and answers too short to compare are all *inconclusive* and move no stake, so a
  flaky provider is never mistaken for a cheating one.
- The whole trail is on public HCS topics, so any observer can replay the verdict from Mirror
  Node data. See [PROOF.md](PROOF.md) and [TRANSACTIONS.md](TRANSACTIONS.md).

## Run it

```bash
pnpm verifier                     # mock mode by default (in-memory stakes, no chain)
MOCK_MODE=false pnpm verifier     # native HBAR slash (needs HEDERA_VERIFIER/ESCROW creds)
```

| Env var | Default | Purpose |
|---|---|---|
| `MOCK_MODE` | `true` | in-memory stakes/slashes when true |
| `EXCHANGE_URL` | `http://localhost:4100` | exchange to watch + call `/slash` |
| `VERIFY_INTERVAL_MS` | `15000` | audit cadence |
| `VERIFY_LOG_LIMIT` | `500` (the exchange's buffer) | how many recent requests each tick considers |
| `SIMILARITY_THRESHOLD` | `0.35` | fraud line (below ⇒ divergent) |
| `SLASH_HBAR` | `25` | amount moved escrow → treasury on a slash |
| `REPLAY_TIMEOUT_MS` | `20000` | per-replay timeout |
| `HEDERA_VERIFIER_ID` / `_KEY`, `HEDERA_ESCROW_ID` / `_KEY` | from `pnpm setup-hedera` | verifier wallet + escrow key it holds (real mode) |

## Code map

| File | Responsibility |
|---|---|
| `packages/verifier/src/audit-selection.ts` | choose a real (non-audit) request to replay (unit-tested) |
| `packages/verifier/src/verification.ts` | replay accused vs witness, decide the verdict (unit-tested) |
| `packages/verifier/src/similarity.ts` | unicode-safe bigram-Jaccard similarity + classification (unit-tested) |
| `packages/verifier/src/index.ts` | orchestration: sample → replay → slash on-chain → publish verdict → notify exchange |

*Component of **AgentRouter** — the on-chain OpenRouter. See the root
[`README.md`](../README.md) and [ARCHITECTURE.md](ARCHITECTURE.md).*
