# ROADMAP.md — where AgentRouter goes after the hackathon

What shipped, what is deliberately out of scope, and the order we would build the rest in.
Every "next" item below is tracked as a real issue in this repo.

## Shipped (the hackathon MVP)

The full economic loop runs end-to-end on Hedera Testnet, hosted and publicly reachable:

- **Per-request payment** — agents buy single completions in **USDC** (HTS `0.0.429274`) over
  x402 v2 (`exact` on `hedera:testnet`), through a fee-sponsored facilitator so payers need
  zero gas. `SETTLEMENT_ASSET=hbar` switches the whole system to native HBAR.
- **A taker fee that funds the exchange** — `EXCHANGE_FEE_BPS` (1000 = 10%) is added on top of
  the provider's price; the provider receives exactly what it quoted. See
  [BUSINESS.md](BUSINESS.md).
- **On-chain identity + discovery** — providers and the agent publish HCS-14 Universal Agent
  IDs to an HCS registry topic; the exchange discovers supply by reading it back through the
  Mirror Node.
- **Tamper-evident audit trail** — HCS topics record every identity, every routed buy, every
  verifier ruling, and the agent's own purchase history.
- **Staking and slashing with no Solidity** — providers bond 50 ℏ to an escrow *account* via a
  native `TransferTransaction`; a fraud verdict moves 25 ℏ escrow → treasury the same way.
- **Reputation as an HTS token** — providers hold 100 ARBOND; a fraud verdict freezes it and
  then wipes it under a 2-of-2 multi-signature (verifier + auditor). Reputation is a token
  anyone can query, not a row in our database.
- **Optimistic fraud detection** — the verifier replays sampled prompts at temperature 0
  against an honest witness and slashes providers whose answers diverge.
- **Pluggable compute supply** — providers serve from **0G Compute** (the default for
  bring-your-own supply), the Groq API, or a canned offline fallback.
- **Self-serve provider onboarding** — a guided skill plus an MCP server take a new provider
  from zero to discoverable, verifying each step on-chain
  ([#28](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/28)).

Receipts: [PROOF.md](PROOF.md) and [TRANSACTIONS.md](TRANSACTIONS.md). Live URLs:
[TESTING.md](TESTING.md).

## Next — turn the marketplace into a business

The revenue levers are designed into the protocol; none need new Hedera primitives. Tracked
under the revenue epic ([#12](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/12)).

| Lever | Issue | Status |
|---|---|---|
| Taker fee — charge the buyer a percentage on top of the provider price | [#13](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/13) | **Live in the MVP**: 10% (`EXCHANGE_FEE_BPS`), provider paid in full, fee accrued at `/stats` |
| USDC (HTS `0.0.429274`) as the settlement asset | [#11](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/11), [#35](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/35) | **Shipped** — default; HBAR behind `SETTLEMENT_ASSET=hbar` |
| Listing stake / fee — turn provider collateral into a listing mechanism | [#14](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/14) | Designed; the 50 ℏ stake and the ARBOND bond exist, a *fee* does not |
| Verifier rewards funded from slashed stakes | [#15](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/15) | Designed; slashing works, the payout split does not exist |

See [BUSINESS.md](BUSINESS.md) for the unit economics behind these.

## Then — harden the trust model

The MVP is honest about its trust assumptions; this is the work that removes them.

- **Escrow is key-held, not contract-enforced**
  ([#31](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/31)) — the verifier holds
  the escrow key, so it is trusted to slash honestly. Production moves the bond into a staking
  contract or a threshold escrow. The ARBOND wipe already requires 2-of-2, which is the shape
  the HBAR side should follow.
- **A single verifier is a single point of trust** — production needs verifier *sets* posting
  competing attestations to the verdicts topic, with their own stakes and a dispute path. The
  HCS verdict trail is already the right substrate for this.
- **Verifier state is in-memory**
  ([#7](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/7),
  [#8](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/8)) — a restart can re-audit
  and re-slash, and audit coverage is capped at the newest entries in the request log.
- **Endpoint authentication**
  ([#31](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/31)) — the slash/verify
  endpoints are unauthenticated and payments are unbounded.

Stronger verification than optimistic replay — TEE attestation or zkML proofs — is the
long-term answer and was explicitly out of MVP scope.

## Later — scale the market

- **Independent GPU supply**
  ([#34](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/34)) — providers resell 0G
  Compute or Groq today. A local model backend is the step toward supply that depends on no
  hosted API at all.
- **Auction-based routing**
  ([#10](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/10)) — replace
  cheapest-first with an auction so providers compete on more than a static price.
- **Self-hosted facilitator**
  ([#36](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/36)) — remove the
  dependency on a hosted x402 facilitator.
- **Hedera Mainnet**
  ([#16](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/16)) — a network string,
  an asset id, and a facilitator change, not an architecture change.

## Deliberately not in the MVP

Called out so the scope is unambiguous:

- Real GPU operations — the marketplace and verification mechanics are the contribution.
- TEE / zkML verification — the verifier does optimistic replay-and-compare sampling.
- A trustless staking contract — the HBAR escrow is verifier-held.
- Orderbook / auctions — routing is cheapest-first among live claimants.
- Mainnet — Hedera Testnet only.
