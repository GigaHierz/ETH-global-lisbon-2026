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
- **Settlement asset:** native **HBAR**, tinybar-exact via x402 v2 `exact`.
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

### Client (paying fetch — `@x402/fetch` + `@x402/hedera`, see `packages/exchange/src/payer.ts`)
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

- **UAID:** `uaid:aid:hedera:testnet:0.0.<account>` (see `packages/provider/src/registry.ts`).
- **Registration:** a signed JSON message to the HCS registry topic (`0.0.9744593`) carrying
  `{agentId, account, displayName, model, price, stakeHbar, stakeTx}` — the on-chain,
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
2. Chain: **Hedera Testnet** (`hedera:testnet`), HTS USDC settlement (native HBAR behind `SETTLEMENT_ASSET=hbar`).
3. Funding: create a testnet operator at https://portal.hedera.com, then `pnpm setup-hedera`
   creates + funds all role accounts from the operator — no faucets on the critical path.
4. MOCK_MODE=true is a first-class path: in-memory ledger/registry/stakes, no RPC, canned Groq responses if no key.


## 0G stack (verified 2026-07-26)

Full prize-track mapping in [0G_BOUNTIES.md](0G_BOUNTIES.md). Network: 0G Galileo testnet,
chain **16602**, RPC `https://evmrpc-testnet.0g.ai`, explorer `https://chainscan-galileo.0g.ai`,
faucet `https://faucet.0g.ai` (0.1 0G/wallet/day).

### 0G Compute (inference)
- **Compute Router** (default path): `https://router-api.0g.ai/v1` — OpenAI-compatible; `GET
  /v1/models` is public (in-house `0gm-1.0-35b-a3b`, deepseek, qwen3.x, glm-5…); completions require
  `Authorization: Bearer <ZEROG_API_KEY>` from https://pc.0g.ai. TEE via the
  `X-0G-Provider-Trust-Mode: verified` header. Implemented: `packages/provider/src/backends/zerog.ts`
  (`completeViaRouter`). Provider4 (NimbusAI) advertises `0gm-1.0-35b-a3b`.
- **Broker SDK** (opt-in, real TEE verification): `@0gfoundation/0g-compute-ts-sdk` v0.9.0
  (`@0glabs/0g-serving-broker` is the deprecated name) — `createZGComputeNetworkBroker(wallet)`,
  `listService()` → filter `verifiability === "TeeML"`, `acknowledgeProviderSigner`,
  `getRequestHeaders`, `processResponse` (verify TEE-signed response via the `ZG-Res-Key` chatID).
  Contracts auto-detected from chain 16602. Implemented behind `ZEROG_BROKER_ENABLED=1`:
  `packages/provider/src/backends/zerog.ts` (`completeViaBroker`); verifier hard-proof short-circuit
  in `packages/verifier/src/index.ts`.

### 0G Chain (verification + Agentic ID) — EVM, Solidity
- `packages/onchain-0g` (Foundry): `VerdictRegistry.sol` (on-chain verdict log) + `AgentNFT.sol`
  (ERC-7857-style Agentic ID). Deploy: `forge script script/Deploy.s.sol --rpc-url $ZEROG_CHAIN_RPC
  --private-key $ZEROG_CHAIN_KEY --broadcast`. Writers via `viem`: `packages/shared/src/zerog.ts`
  (`recordVerdictOnZeroG`, `mintAgenticId`, `updateAgenticIdMemory`).
- Live **ERC-8004 IdentityRegistry** `0x8004A818BFB912233c491871b3d84c89A494BD9e` (name
  `AgentIdentity`, unverified source — static-call `register` before broadcasting). Optional
  discoverability path.

### 0G Storage (encrypted memory)
- `@0gfoundation/0g-storage-ts-sdk` v1.2.10 (has built-in AES-256; the older `@0glabs/0g-ts-sdk`
  0.3.3 does not) — `new Indexer(url)`, `new MemData(buffer)`, `indexer.upload(file, rpc, signer,
  { encryption: { type: "aes256", key } })` → `{ rootHash, txHash }`; `downloadToBlob(root, { proof,
  decryption })`. Indexer `https://indexer-storage-testnet-turbo.0g.ai`. Implemented:
  `packages/agent/src/memory-0g.ts`.
