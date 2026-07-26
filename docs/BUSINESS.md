# BUSINESS.md — business model and unit economics

How AgentRouter makes money, who pays, and what the on-chain footprint of that business is.
The unit economics below are the **real numbers running in the MVP**, not projections —
every figure is a live constant in the code or a verified on-chain transaction.

> **Before pitching:** the market-size figures in *Market* are marked `[CITE]` and must be
> filled in with a real, linkable source. The judging rubric explicitly rewards "numbers
> based on cited data sources" and penalises numbers that "did not make sense." Do not
> present an uncited TAM.

## Lean canvas

| | |
|---|---|
| **Problem** | When you call an LLM API you *trust* the provider is running the model you paid for. There is no verification. A provider can advertise a 70B model, serve an 8B model, pocket the margin, and **undercut honest competitors on price** — the cheapest fraud wins the routing war. Autonomous agents, with no human in the loop, cannot detect this. |
| **Customer segments** | Primary: developers building autonomous agents that buy inference programmatically. Secondary: inference providers who are *honest* and are currently being undercut by those who are not. |
| **Unique value proposition** | The only inference marketplace where the provider's claim about which model it serves is **economically enforced** — lie about your model and lose your bond. Verification makes prices honest, not just low. |
| **Solution** | An OpenAI-compatible routing exchange: per-request payment in USDC over x402, provider identity and reputation on HCS, staked collateral, and a verifier that replays sampled prompts and slashes divergent providers. |
| **Unfair advantage** | The slash record is **portable**. Reputation lives on public HCS topics and an HTS token, not in our database — a provider slashed on AgentRouter carries that record to any marketplace reading the same topics. Network effects accrue to the audit trail, not to us. |
| **Channels** | `base_url` swap — the exchange is OpenAI-compatible, so any existing OpenAI SDK client adopts it with a one-line change. Provider onboarding via a guided skill and an MCP server ([#28](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/28)). |
| **Key metrics** | Requests routed/day · USDC settled/day · providers staked · frauds caught · **fee revenue** · slash rate |
| **Cost structure** | Hedera fees (fractions of a cent per transfer / HCS message) · verifier inference cost for replays · refunds absorbed on provider failure · hosting. No GPU capex — supply is the providers' problem. |
| **Revenue streams** | Taker fee · listing stakes · verifier rewards from slashes (below) |

## Revenue streams

Three levers, all designed into the protocol. Each is tracked as an issue under the revenue
epic ([#12](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/12)).

### 1. Taker fee — **live in the MVP** ([#13](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/13))

The exchange charges the buyer a **percentage fee on top of** the provider's price. The
provider receives exactly what it quoted; the fee is the exchange's revenue.

| | Value | Source |
|---|---|---|
| Fee rate | **1000 bps = 10%** of the provider's price | `EXCHANGE_FEE_BPS`, `packages/shared/src/hedera.ts` |
| Provider's ask (honest 70B) | **0.10 USDC** / request | provider `price` |
| Exchange fee | **0.01 USDC** / request | `feeForPrice()`, `packages/shared/src/hedera.ts` |
| **Buyer pays** | **0.11 USDC** / request | `totalForPrice()` = price + fee |
| **Take rate** | **9.09%** of buyer spend | 0.01 / 0.11 |

Both legs are real x402 settlements. The fee is not a bookkeeping entry — it is the
difference between what the agent transfers in and what the exchange transfers out. Returned
on every response as `agentrouter.{ price, fee, total, asset }`, and accumulated at
`GET /stats` as `feeRevenue` alongside the active `feeBps`.

Three implementation details that matter commercially:

- **The provider is never shaved.** Under the earlier flat-ask design the exchange kept the
  difference between a fixed buyer price and whatever the provider charged, so routing to a
  *cheaper* provider silently earned the exchange more. Charging on top removes that conflict
  of interest: revenue now scales with volume rather than with a spread we can hide, so the
  incentive is aligned with genuinely routing to the cheapest provider.
- **Fees round up, in integer base units.** `fee = ceil(price × feeBps / 10000)`, computed in
  tinybars (HBAR, 10⁻⁸) or micro-USDC (10⁻⁶) — never floats. The exchange cannot underquote
  itself, and no sub-unit dust accumulates on either side.
- **Quotes are pinned.** The 402 challenge carries a quote keyed to the request body and held
  for a TTL; the paid retry settles against that pinned quote. A buyer cannot be charged a
  price different from the one it was quoted, even if the routing table moves underneath it.

*10% is a demo-scale number chosen for legibility on stage.* It is a single env var
(`EXCHANGE_FEE_BPS`) — a production rate would compress toward low single digits under
competition; the mechanism is unchanged.

### 2. Listing stake ([#14](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/14))

Providers bond **50 ℏ** (`STAKE_HBAR`) to the escrow account to be listed, and hold **100
ARBOND** (`BOND_AMOUNT`), an HTS ReputationBond token that *is* their on-chain reputation.
Turning either into a listing *fee* monetises supply-side access and raises the cost of sybil
listings. Every stake is a verifiable on-chain transfer — see
[TRANSACTIONS.md](TRANSACTIONS.md).

Note the deliberate split: the bond stays denominated in **HBAR and ARBOND regardless of the
settlement asset**. Collateral is a Hedera-native security property; the currency the market
happens to trade in is not.

### 3. Verifier rewards funded from slashes ([#15](https://github.com/GigaHierz/ETH-global-lisbon-2026/issues/15))

A fraud verdict moves **25 ℏ** (`SLASH_HBAR`) from escrow to treasury *and* freezes, then
wipes, the provider's ARBOND under a 2-of-2 multi-signature (verifier + auditor). Routing a
share of each slash to the verifier that caught it makes policing self-funding and, once there
are verifier sets, makes honest verification the profitable strategy. This is the mechanism
that lets the trust layer scale without us paying for it.

**Why this ordering matters:** the fee funds operations, the listing stake funds supply
quality, and slashes fund the trust layer. Each revenue stream pays for the part of the
system it comes from.

## Unit economics per routed request

Verified from the running system, at the default 10% fee against a 0.10 USDC provider ask:

```
buyer pays            0.11 USDC   (x402 settle: agent → exchange)
provider receives     0.10 USDC   (x402 settle: exchange → provider)
──────────────────────────────────
fee revenue           0.01 USDC   (9.09% of buyer spend, 10% of provider price)
less Hedera fees      ~fractions of a cent (2 transfers + 1 HCS message)
```

Hedera's fee model is what makes this viable: a 0.01 USDC fee survives only because the
settlement and audit cost is a rounding error against it. **This business does not close on a
chain with variable gas fees** — per-request micropayments require predictable, sub-cent
finality, which is the specific reason the project is built on Hedera.

Two costs sit against that fee, both implemented rather than hypothetical:

- **Refunds.** If the provider call fails *after* the agent's payment settled, the exchange
  refunds it (`REFUND_ON_FAILURE`, default true) — counted as `refunds` on `/stats`.
- **Absorbed cost.** If the agent's inbound settlement fails after the answer was already
  served, the exchange has paid the provider and eats the difference. Rare, logged loudly, and
  counted — which is why `refundFailures` is a metric rather than an assumption.

> **Settlement asset.** USDC (HTS `0.0.429274`, 6 dp) is the default; `SETTLEMENT_ASSET=hbar`
> switches the whole system to native HBAR. The fee arithmetic is scale-agnostic — only the
> conversion at the edges knows the asset — so the economics above hold in either currency.
> `DEFAULT_EXCHANGE_ASK = 0.12` still exists in the code but is **mock-mode only**: the flat
> amount the demo agent puts in the mock payment header when there is no chain. It is not the
> production pricing mechanism and should not be quoted as one.

## Why this has to be Web3

The rubric asks whether Web2 could deliver this. It could not:

- **Per-request payment with no relationship** — an agent that has never seen a provider
  before buys exactly one completion. No account, no API key, no subscription, no KYC. That is
  x402 over HTTP, settled in USDC on Hedera.
- **Portable reputation** — the value of a slash is that it follows the provider off our
  platform. In Web2 the reputation is our database and dies with us; on HCS it is a public,
  tamper-evident topic anyone can read, and the ARBOND balance is a token anyone can query.
- **Credible punishment** — "we'll ban you" is not a deterrent when re-registering is free.
  Losing a staked bond is. That requires programmable value.

## Market

**Fill these in with cited sources before pitching.**

- Total AI inference / LLM API spend: `[CITE]`
- Growth rate of agent-initiated (non-human) API traffic: `[CITE]`
- Size of the model-routing / aggregation layer, e.g. an incumbent router's annualised
  throughput as a proxy for the routable market: `[CITE]`

**Serviceable slice:** the fraction of inference spend that is (a) routed through an
aggregator rather than bought direct, and (b) initiated by an autonomous agent rather than a
human. Both fractions are small today and both are growing — that is the bet.

**Revenue framing:** at the default 10% fee, every 1M routed requests against a 0.10 USDC
provider ask moves **110,000 USDC** of buyer spend and yields **10,000 USDC** of fee revenue.
Substitute the honest production fee rate and the routable volume from the cited sources above
to size it.

## Impact on the Hedera network

Every unit of business activity is on-chain — growth in usage *is* growth in Hedera metrics.
Quantified in the README's **Network impact** section and verifiable on the live topics.

| Business event | Hedera transactions produced |
|---|---|
| New agent or provider onboards | 1 account created + 1 HCS registry message (HCS-14 identity) |
| Provider lists | 1 HBAR transfer (stake → escrow) + 1 HTS transfer (ARBOND bond) |
| **One inference request** | **2 settlement transfers (x402, both legs) + 1 HCS trade message** |
| One audit | up to 2 x402 replay payments + 1 HCS verdict message |
| One fraud caught | 1 HBAR transfer (escrow → treasury) + HTS freeze + multi-sig wipe + 1 HCS verdict message |

The load is dominated by the per-request path, so network impact scales linearly with
marketplace volume: **3 on-chain transactions per inference call.**

## Related documents

- [TRANSACTIONS.md](TRANSACTIONS.md) · [PROOF.md](PROOF.md) — the on-chain receipts behind these numbers
- [GUIDE.md](GUIDE.md) — env vars including `EXCHANGE_FEE_BPS`, and the pricing walk-through
- [exchange.md](exchange.md) — the routing and settlement path the fee is charged on
- [DEVREL_BRIEF.md](DEVREL_BRIEF.md) — the narrative and the real-vs-mocked breakdown
