# PAYMENTS.md — how money moves, and how paying 0G would look

This is the map of AgentRouter's payment path: what settles today, on which rail,
and how a real **payment to the 0G network** would slot in. The first half is
implemented and live; the "Paying 0G" half is a **design sketch — not yet built**.

---

## Today: value settles in USDC over x402 on Hedera

The economic loop is HTTP-native micropayments (x402) denominated in the
settlement asset (USDC, or HBAR under the legacy asset), settled on **Hedera**.
0G is **not** in the money path yet — see the next section.

```
 Agent ──① x402 pay ─────▶  Exchange ──② forward ─────▶  Provider
 (buyer)  USDC / Hedera        (broker)   USDC / Hedera     (e.g. a 0G reseller)
   │      quoted total            │  keeps taker fee
   │      (price + fee)           │
   └ every payment is a Hedera tx → paymentRef → Hashscan link on the UI
```

**① Agent → Exchange** (`packages/agent/src/payer.ts`, `buy.ts`)
- The agent's own Hedera key signs an x402 *exact* payment. `wrapFetchWithPayment`
  reads the `402 Payment Required` challenge returned by the exchange and pays the
  exact quoted total automatically; the on-chain network fee is sponsored by a
  facilitator `feePayer`.
- `parseBuyResult` reads back `agentrouter.total` (provider price + exchange taker
  fee) — that is what the agent's budget is charged.

**② Exchange → Provider** (`packages/exchange/src/payer.ts`)
- The exchange transfers the provider's price to the provider's Hedera wallet and
  keeps the taker fee. In `MOCK_MODE` this is the in-memory `mockLedger`; in real
  mode it is a Hedera transfer of the settlement asset.
- Failed trades are refunded on the same asset (`packages/exchange/src/refund.ts`).

**Records.** Each payment carries a `paymentRef` (the Hedera settlement tx),
surfaced as a Hashscan link in the dashboard, and trades are logged to HCS topics
for durable, on-chain history.

### Where 0G sits today: gas, not revenue

0G is used as **supply and provenance**, but nothing meters a payment *to* 0G per
request:

| 0G surface | Who pays | In what | Nature |
|---|---|---|---|
| 0G Storage (encrypted memory upload) | `ZEROG_CHAIN_KEY` wallet | native 0G | gas + storage fee, per upload |
| 0G Chain writes (mint / setMemory / verdict) | `ZEROG_CHAIN_KEY` wallet | native 0G | gas, per tx |
| 0G Compute (inference) | — | — | demo uses the canned/operator-absorbed path; **not metered** |

So we *use* 0G Compute as a supply network but don't *pay* 0G for it. That is the
gap the design below closes.

---

## Design sketch: paying 0G (not yet implemented)

0G Compute is not pay-per-HTTP-call like x402. It uses a **prepaid broker/ledger**
in 0G's own token (OG / A0GI): you fund a ledger once, then each inference **debits
a micro-fee** and returns a **TEE attestation**. Dropped into our architecture, the
provider becomes a genuine reseller — earning USDC on Hedera, spending OG on 0G:

```
        ┌─ USDC in (Hedera, exactly as today) ─┐
 Agent ─x402 USDC─▶ Exchange ─USDC─▶ Provider (0G reseller)
                                        │  holds a 0G Compute broker account
                                        │  ledger balance denominated in OG
                                        ▼
                             0G Compute Broker / Ledger
                                        │  per request: sign headers, provider
                                        │  serves, broker debits OG (settleFee),
                                        │  returns a TEE attestation
                                        ▼
                             0G GPU provider ── completion ──▶ back to agent
   top-up: provider periodically swaps some USDC ──▶ OG to refill the ledger
   provider margin = USDC charged  −  OG cost per inference
```

### Three design decisions this forces

1. **Who holds the 0G ledger?**
   - *Provider-funded (smallest change):* the 0G-reseller provider keeps the OG
     ledger; it earns USDC on Hedera and spends OG on 0G. No change to the agent —
     the exchange economics stay identical. **Recommended starting point.**
   - *Agent-direct:* the agent holds its own OG ledger and calls 0G Compute
     directly for 0G-served models, bypassing the exchange for those.

2. **The currency bridge.** Revenue arrives as USDC (Hedera); 0G costs are in OG
   (0G Chain). Something has to swap USDC → OG to keep the ledger funded. That FX +
   top-up cadence is the only genuinely new economic component — everything else is
   existing rails.

3. **Optionally settle the 0G leg on 0G too ("everything on 0G").** 0G Chain is
   EVM and x402 has EVM schemes, so the agent could pay the 0G provider **directly
   in a 0G-native token via x402 on 0G Galileo** instead of Hedera:
   ```
   Agent ─x402 (0G Chain / EVM exact scheme)─▶ Provider ─▶ 0G Compute ledger (OG)
   ```
   Then settlement *and* compute both live on 0G for those models — no Hedera leg.
   Cleaner story, but needs an x402-on-0G scheme plus a settlement token wired up.

### Tie-in with the existing on-chain provenance leg

We already write TEE verdicts to `VerdictRegistry.sol` (see `docs/PROOF-0G.md`).
0G Compute's per-request TEE attestation is exactly the input that verdict feed
consumes — so "pay 0G for a TEE-verified inference → record the verdict on 0G
Chain" closes the loop with the provenance leg we already have.

### Implementation shape (if/when built)

- Gate it behind the same `MOCK_MODE` discipline as the rest of the payment code:
  no `ZEROG_*` compute config → canned/no-op, existing demo unchanged.
- Provider-side module (mirrors `packages/agent/src/payer.ts`): create the 0G
  Compute broker, fund/acknowledge a provider, attach signed request headers, and
  `settleFee` per inference — returning the attestation alongside the completion.
- Surface the OG spend + ledger balance in the exchange/provider UI the way the
  USDC settlement is surfaced today, so the "USDC in, OG out" margin is visible.

> Status: **design only.** Nothing in this "Paying 0G" section is wired up. The
> live payment path is the Hedera/x402 loop described in the first half.
