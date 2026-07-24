# RESEARCH.md — verified 2026-07-24 (ETHGlobal Lisbon)

## x402 (Coinbase / x402 Foundation)

**Use the scoped `@x402/*` v2 packages** (current line, published 2026-07-17). The unscoped
`x402-express` / `x402-fetch` packages are the legacy v1 line (last meaningful update 2026-04) — do not use.

| Package | Version | Role |
|---|---|---|
| `@x402/express` | 2.19.0 | Server payment middleware (`paymentMiddleware`, `x402ResourceServer`) |
| `@x402/fetch` | 2.19.0 | Paying client (`x402Client`, `wrapFetchWithPayment`, `x402HTTPClient`) |
| `@x402/evm` | 2.19.0 | EVM scheme impls (`ExactEvmScheme` — separate `/exact/server` and `/exact/client` entry points) |
| `@x402/core` | 2.19.0 | `HTTPFacilitatorClient` (from `@x402/core/server`) |

- **Facilitator (hosted, testnet):** `https://x402.org/facilitator` — probed live, supports
  `{scheme: "exact", network: "eip155:84532"}` (x402Version 2). Base Sepolia = CAIP-2 `eip155:84532`.
- **Price format:** dollar string with `$` prefix, e.g. `"$0.002"`. Settles in testnet USDC.

### Server (verified from coinbase/x402 `examples/typescript/servers/express`)
```ts
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" }))
  .register("eip155:84532", new ExactEvmScheme());

app.use(paymentMiddleware({
  "POST /v1/chat/completions": {
    accepts: [{ scheme: "exact", price: "$0.002", network: "eip155:84532", payTo: evmAddress }],
    description: "...", mimeType: "application/json",
  },
}, server));
```

### Client (verified from `examples/typescript/clients/fetch`)
```ts
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(pk)));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
// settle receipt: new x402HTTPClient(client).getPaymentSettleResponse(n => res.headers.get(n))
```

Links: https://github.com/coinbase/x402 · https://docs.cdp.coinbase.com/x402 · npm `@x402/*`

## ERC-8004 (Trustless Agents)

Official reference deployments are **live on Base Sepolia** (verified `eth_getCode` — both are proxies):

- **IdentityRegistry:** `0x8004A818BFB912233c491871b3d84c89A494BD9e` (ERC-721; `register()`, `register(string agentURI)`, `setAgentURI`, `setAgentWallet`; `Registered(uint256 agentId, string agentURI, address owner)` event)
- **ReputationRegistry:** `0x8004B663056A597Dffe9eCcC1965A193B7388713`
  (`giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)`;
  `getSummary(agentId, address[] clients, tag1, tag2)`; **self-feedback by owner/operator reverts** — feedback must come from a different wallet, e.g. exchange/verifier)
- **ValidationRegistry:** no Base Sepolia address published → we skip on-chain validation; slashing via our own `Staking.sol` + reputation feedback covers the demo.

Repo: https://github.com/erc-8004/erc-8004-contracts (Hardhat, UUPS upgradeable) · Spec: https://eips.ethereum.org/EIPS/eip-8004

## Groq

- OpenAI-compatible endpoint: `POST https://api.groq.com/openai/v1/chat/completions` (Bearer GROQ_API_KEY)
- Model IDs (verified from console.groq.com/docs/models):
  - `llama-3.3-70b-versatile` — provider1 (the "premium" model)
  - `llama-3.1-8b-instant` — provider2's cheap model, **and provider3's secret cheat model**
    (`llama-3.2-1b` is no longer served by Groq; 8b-instant is the smallest llama — divergence from 70b at temp 0 is still reliable)

## Decisions

1. Use official ERC-8004 registries on Base Sepolia — no registry deployment needed. Only `Staking.sol` is ours.
2. Chain: Base Sepolia (`eip155:84532`), RPC `https://sepolia.base.org`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (canonical Circle testnet USDC on Base Sepolia).
3. Funding: Base Sepolia ETH via https://portal.cdp.coinbase.com/products/faucet or https://www.alchemy.com/faucets/base-sepolia; testnet USDC via https://faucet.circle.com (select Base Sepolia).
4. MOCK_MODE=true is a first-class path: in-memory ledger/registry/stakes, no RPC, canned Groq responses if no key.
