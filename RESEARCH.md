# RESEARCH.md — verified 2026-07-24 (ETHGlobal Lisbon)

## x402 (Coinbase / x402 Foundation)

**Use the scoped `@x402/*` v2 packages** (current line, published 2026-07-17). The unscoped
`x402-express` / `x402-fetch` packages are the legacy v1 line (last meaningful update 2026-04) — do not use.

| Package | Version | Role |
|---|---|---|
| `@x402/express` | 2.19.0 | Server payment middleware (`paymentMiddleware`, `x402ResourceServer`) |
| `@x402/fetch` | 2.19.0 | Paying client (`x402Client`, `wrapFetchWithPayment`, `x402HTTPClient`) |
| `@x402/hedera` | 2.19.0 | Hedera scheme impls (`ExactHederaScheme`, `createClientHederaSigner` — separate `/exact/server` and `/exact/client` entry points) |
| `@x402/core` | 2.19.0 | `HTTPFacilitatorClient` (from `@x402/core/server`) |

- **Network:** `hedera:testnet` (CAIP-2). Explorer: Hashscan (`https://hashscan.io/testnet`).
- **Settlement asset:** native **HBAR** by default (`SETTLEMENT_ASSET=hbar`), tinybar-exact via
  x402 v2 `exact`. Optional USDC path uses HTS token `0.0.429274` (6 decimals).
- **Facilitator ladder (hosted, testnet):** tries `https://api.testnet.blocky402.com`, then
  `https://x402.org/facilitator` — both list `{scheme:"exact", network:"hedera:testnet"}` and
  **sponsor the settlement fee** (feePayer sponsorship — payers need zero gas).

### Server (provider paywall — `@x402/express` + `@x402/hedera`)
```ts
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
  .register("hedera:testnet", new ExactHederaScheme());

app.use(paymentMiddleware({
  "POST /v1/chat/completions": {
    accepts: [{ scheme: "exact", price: hbarPrice, network: "hedera:testnet", payTo: accountId }],
    description: "...", mimeType: "application/json",
  },
}, server));
```

### Client (paying fetch — `@x402/fetch` + `@x402/hedera`, see `exchange/src/payer.ts`)
```ts
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner } from "@x402/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";

const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network: "testnet" });
const client = new x402Client();
client.register("hedera:testnet", new ExactHederaScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
// settle receipt: new x402HTTPClient(client).getPaymentSettleResponse(n => res.headers.get(n))
```

Links: https://github.com/coinbase/x402 · https://docs.cdp.coinbase.com/x402 · npm `@x402/*`

## Agent identity — HCS-14 (Universal Agent IDs)

Identity is **native to Hedera** — no EVM registries. Each agent/provider gets an HCS-14-style
Universal Agent ID and publishes a registration record to the HCS registry topic.

- **UAID:** `uaid:aid:hedera:testnet:0.0.<account>` (see `provider/src/registry.ts`).
- **Registration:** a signed JSON message to the HCS registry topic (`0.0.9744593`) carrying
  `{agentId, account, displayName, model, priceHbar, stakeHbar, stakeTx}` — the on-chain,
  Mirror-Node-readable directory the exchange discovers providers from.
- **Reputation / audit:** trades → topic `0.0.9744594`, verifier verdicts → topic `0.0.9744595`.
- **Staking / slash (no Solidity):** stake 50 ℏ to the escrow account via a Hedera SDK
  `TransferTransaction`; a fraud verdict slashes escrow→treasury with a second SDK transfer plus
  a verdict message to HCS. HCS-14 is spec-bridged to ERC-8004 / A2A / x402 if EVM interop is ever needed.

Spec: https://hol.org/docs/standards/hcs-14/

## Groq

- OpenAI-compatible endpoint: `POST https://api.groq.com/openai/v1/chat/completions` (Bearer GROQ_API_KEY)
- Model IDs (verified from console.groq.com/docs/models):
  - `llama-3.3-70b-versatile` — provider1 (the "premium" model)
  - `llama-3.1-8b-instant` — provider2's cheap model, **and provider3's secret cheat model**
    (`llama-3.2-1b` is no longer served by Groq; 8b-instant is the smallest llama — divergence from 70b at temp 0 is still reliable)

## Decisions

1. Identity/reputation are HCS-native (HCS-14 UAID + HCS topics) — no registry contract to deploy.
2. Chain: **Hedera Testnet** (`hedera:testnet`), native HBAR settlement (`SETTLEMENT_ASSET=hbar`);
   optional USDC path via HTS token `0.0.429274`.
3. Funding: create a testnet operator at https://portal.hedera.com, then `pnpm setup-hedera`
   creates + funds all role accounts from the operator — no faucets on the critical path.
4. MOCK_MODE=true is a first-class path: in-memory ledger/registry/stakes, no RPC, canned Groq responses if no key.
