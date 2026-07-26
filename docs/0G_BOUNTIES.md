# AgentRouter × 0G prize tracks

How AgentRouter maps to the 0G bounties we target at ETHGlobal Lisbon 2026 — **Infrastructure &
Tooling (#2)** as the primary track, and **AI Product (#1)** as a secondary. Every "Implemented"
line is real and SDK-native across four 0G products: **0G Compute** (inference, OpenAI-compatible
Router + `@0gfoundation/0g-compute-ts-sdk` broker with TEE verification), **0G Chain** (Galileo
testnet, chain `16602` — a `VerdictRegistry` for on-chain verification and an ERC-7857-style
`AgentNFT` Agentic ID), and **0G Storage** (`@0gfoundation/0g-storage-ts-sdk`, AES-256-encrypted
agent memory). "Natural extension" lines are explicitly *not yet built*. Everything below has been **run live on
0G Galileo (2026-07-26)** — real TEE-attested inference, both contracts deployed, a verdict recorded,
and Agentic ID #1 minted (see "Live on 0G Galileo").

One-liner: **AgentRouter is an on-chain OpenRouter that routes inference across 0G's hosted models,
carries per-request provenance (which model actually served, TEE-attested where the provider
supports it) into an on-chain `VerdictRegistry` on 0G Chain, and tokenizes its buyer agent as an
ERC-7857-style Agentic ID whose tradeable state is its AES-256-encrypted memory in 0G Storage.**

The stack, verified against code (not docs): **0G Compute** Router (`router-api.0g.ai/v1`,
`X-0G-Provider-Trust-Mode: verified`) + `@0gfoundation/0g-compute-ts-sdk` broker
(`packages/provider/src/backends/zerog.ts`), **0G Chain** Galileo via `viem`
(`packages/shared/src/zerog.ts`) with `VerdictRegistry.sol` + `AgentNFT.sol`
(`packages/onchain-0g/`, Foundry), **0G Storage** via `@0gfoundation/0g-storage-ts-sdk`
(`packages/agent/src/memory-0g.ts`), model routing (`packages/agent/src/route-model.ts`,
`packages/exchange/src/discovery.ts`), and an optimistic + TEE-short-circuit verifier
(`packages/verifier/src/index.ts`). 0G's live ERC-8004 registry
(`0x8004A818BFB912233c491871b3d84c89A494BD9e`) is wired as an optional discoverability path.

---

### Live on 0G Galileo (chain 16602, 2026-07-26)

Verified end-to-end against real 0G infrastructure. **Every contract and transaction is linked in
[PROOF-0G.md](PROOF-0G.md)** (explorer `https://chainscan-galileo.0g.ai`). Highlights:

- **0G Compute inference** — a completion served through our provider backend returned
  `servedBy: "0g"`, `upstreamModel: "0gm-1.0-35b-a3b"`, `teeAttested: true`, with an
  `attestationRef` captured from the router under `X-0G-Provider-Trust-Mode: verified`.
- **VerdictRegistry** [`0x5b7da2E9…269eE`](https://chainscan-galileo.0g.ai/address/0x5b7da2E9432E3A3c3C26cA8B30d0BcafF2A269eE)
  — deployed; **6 verdicts recorded** (`count() == 6`), the last written *by the running verifier
  service during `pnpm demo`* ([fraud tx](https://chainscan-galileo.0g.ai/tx/0x2466cea092342960ffe20dbfd00a8789569b43b973901431a85594d926492119)).
- **AgentNFT (Agentic ID)** [`0x85ff2BC0…5875D`](https://chainscan-galileo.0g.ai/address/0x85ff2BC072cBfec881A13bC04E7cbaf79ad5875D)
  — deployed; **3 tokens minted** ([#1](https://chainscan-galileo.0g.ai/tx/0xc396750b764375f58d988e7f4b2faca96fa1cae54ea170d247e7ebe874190994)),
  each token's `intelligentData.dataHash` = its 0G Storage memory root; token #1's memory was
  re-pointed on-chain via [`setMemory`](https://chainscan-galileo.0g.ai/tx/0xf632e0edbf7b7e66ee2bd9f7322ab100afb255dfe556aff03f522560c89ebf13) (tradeable memory).
- **0G Storage** — memory AES-256-encrypted + uploaded; roots resolve on the explorer
  ([upload tx](https://chainscan-galileo.0g.ai/tx/0xb9ff7d904394fa397ea48c4ac256f0aeba987fa08b75e3c7ab5d99da6b8abce9)).

Addresses also in [`../deployments.json`](../deployments.json) (`zerogChain`).

---

## 1 · Infrastructure & Tooling on 0G — **Implemented (primary)**

Build the frameworks, primitives, and developer tooling other teams build their 0G apps and agents
on top of. The bounty's own example: *"Model-routing or provenance layer across 0G's hosted models,
with verification tracked on-chain."* That is exactly what AgentRouter is.

**What we implement**
- **Model-routing across 0G's hosted models** — the buyer agent routes a query to a *model tier*
  from the live market by prompt heuristics (reasoning/code → premium, short factual → simple),
  and the exchange picks the cheapest live provider serving that exact model. 0G Compute is a
  first-class routed supply. `packages/agent/src/route-model.ts:41` (`routeModel`),
  `packages/exchange/src/discovery.ts:104` (`pickProvider`).
- **0G Compute inference, OpenAI-compatible + TEE trust mode** — the provider backend calls the 0G
  Compute Router with `X-0G-Provider-Trust-Mode: verified` and captures any attestation the router
  returns as provenance. `packages/provider/src/backends/zerog.ts:98` (`completeViaRouter`),
  default backend `packages/provider/src/backends/index.ts:13` (`DEFAULT_BACKEND = "0g"`), model
  `packages/shared/src/constants.ts:6` (`ZEROG_MODEL = "0gm-1.0-35b-a3b"`), the NimbusAI provider
  `packages/provider/src/profiles.ts:56`.
- **Real TEE-attestation verification via the SDK** — an opt-in broker path
  (`ZEROG_BROKER_ENABLED=1`) uses `@0gfoundation/0g-compute-ts-sdk` to discover a `TeeML` provider,
  acknowledge its TEE signer, send a signed request, and *cryptographically verify* the response
  (`processResponse`), stamping `teeAttested`. `packages/provider/src/backends/zerog.ts:35`
  (`completeViaBroker`, `verifiability === "TeeML"`, `processResponse`).
- **Provenance carried end-to-end** — `servedBy`, `upstreamModel` (the verbatim router-reported
  model), `teeAttested`, and `attestationRef` flow response → request log → HCS trade message → feed
  rehydration. `packages/shared/src/types.ts` (`ChatCompletionResponse`, `RequestLogEntry`),
  `packages/exchange/src/index.ts` (`onAfterSettle` trade publish), `packages/exchange/src/hydrate.ts`
  (`tradeToEntry`).
- **Verification tracked on 0G Chain** — each 0G-served trade and every verifier verdict is written
  to a `VerdictRegistry` contract on 0G Galileo (`recordVerdict(tradeId, provider, model, servedBy,
  teeAttested, verdict)`), via `viem`. `packages/onchain-0g/src/VerdictRegistry.sol`,
  `packages/shared/src/zerog.ts:113` (`recordVerdictOnZeroG`), written from the exchange
  (`onAfterSettle`, 0G-served trades) and the verifier (`packages/verifier/src/index.ts:353`, fraud).
- **TEE attestation as hard proof** — when a sampled request was 0G-broker-served *and* carried a
  verified TEE attestation, the verifier short-circuits the optimistic Jaccard replay (an attestation
  already proves which model ran) and records a verified verdict on Hedera HCS + 0G Chain.
  `packages/verifier/src/index.ts:263`.
- **Provider onboarding tooling** — an MCP server + guided skill + dashboard walkthrough onboard a
  bring-your-own-compute provider, defaulting to 0G Compute. `packages/provider-mcp/`,
  `.claude/skills/onboarding-a-provider/`, `packages/dashboard/app/providers/onboard/page.tsx`.

**Natural extension** — full `verifyService` deep-attestation gating (TDX/DStack quote + compose
hash) as a routing precondition; a public `@agentrouter/0g` SDK wrapping the router+broker+registry
so other teams get routed, attested, on-chain-logged 0G inference in one call; a guardrail layer
that rejects on-chain actions whose inference wasn't TEE-attested.

**Qualification:** framework/tooling other teams build on ✓ · uses 0G Compute + 0G Chain (+ Storage,
track 2) ✓ · ≥1 working example agent/app using it (the buyer agent + exchange + verifier) ✓ ·
public repo + README + architecture ✓ · `VerdictRegistry` deployed to Galileo
(`0x5b7da2E9432E3A3c3C26cA8B30d0BcafF2A269eE`, `count() == 1`) ✓ · demo video (to record).

---

## 2 · AI Product on 0G — **Implemented**

End-user agents on 0G with private, verifiable inference and encrypted, composable memory. The
bounty's own example: *"Agentic browser companion or extension with tradeable memory via Agentic
ID."* We ship the **tradeable-memory agent** at its core — Agentic ID + encrypted 0G Storage memory
+ TEE-verified 0G Compute — and deliberately scope the browser extension out (see truthfulness note).

**What we implement**
- **Encrypted agent memory in 0G Storage** — the buyer agent's whole call history (its memory) is
  serialized, AES-256-encrypted, and uploaded to 0G Storage via `@0gfoundation/0g-storage-ts-sdk`
  (`MemData` + `Indexer.upload`, built-in `encryption: { type: "aes256" }`), returning the Merkle
  root hash; downloaded + decrypted + Merkle-verified on read. `packages/agent/src/memory-0g.ts`
  (`uploadMemory`, `downloadMemory`).
- **Agentic ID (ERC-7857-style) on 0G Chain** — the agent is minted as an `AgentNFT` whose
  `IntelligentData` points at that 0G Storage memory root, so **owning the token owns the memory**.
  `packages/onchain-0g/src/AgentNFT.sol` (`mint`, `setMemory`, `transferFrom`),
  `packages/shared/src/zerog.ts:234` (`mintAgenticId`), `:265` (`updateAgenticIdMemory`).
- **Tradeable** — `AgentNFT.transferFrom` moves the agent and its memory pointer to a new owner;
  `setMemory` re-points the memory as the agent learns more. `packages/onchain-0g/src/AgentNFT.sol`.
- **Verifiable inference** — the same TEE-attested 0G Compute path as track 1 (trust-mode `verified`
  / broker `processResponse`). `packages/provider/src/backends/zerog.ts`.
- **Live product surface** — `POST /agentic-id/mint` snapshots the agent's memory → 0G Storage →
  mints (or re-points) the Agentic ID; `GET /agentic-id` reports the token, memory root, and
  explorer links. `packages/agent/src/server.ts:262` (`GET /agentic-id`), `:271`
  (`POST /agentic-id/mint`).
- **Optional discoverability** — 0G's live ERC-8004 registry (`0x8004…BD9e`) is recorded in
  `deployments.json` as an additional identity path. `deployments.json` (`zerogChain`).

**Natural extension** — full ERC-7857 privacy-preserving *transfer* with a TEE/ZKP re-encryption
oracle (our transfer moves ownership + pointer but does not re-encrypt); an `AgentMarket` order book
for breeding/merging agents; a browser companion front-end over the existing agent-server API.

**Qualification:** end-user agent on 0G ✓ · 0G Compute for inference (TEE trust mode) ✓ · 0G Storage
for persistent encrypted memory ✓ · Agentic ID for ownership/composability ✓ · public repo + README
+ setup ✓ · working/demoable product (agent-server endpoints) ✓ · minted Agentic ID on the 0G
explorer (AgentNFT `0x85ff2BC072cBfec881A13bC04E7cbaf79ad5875D`, token #1) ✓ · demo video (to record).

---

### Truthfulness note

**0G Chain uses Solidity** (`packages/onchain-0g`, Foundry) — 0G Chain is EVM, unlike the deliberately
no-Solidity Hedera settlement leg. **`AgentNFT` is ERC-7857-*style*** (the code says so): it keeps the
mint + `IntelligentData` + tradeable-ownership + memory-pointer semantics, but full ERC-7857 transfer
needs a TEE/ZKP re-encryption oracle, which is roadmap, not built. **0G Compute inference is live only
with a funded `ZEROG_API_KEY`** (from pc.0g.ai); without it, 0G-backed providers return deterministic
**canned** answers (`servedBy: "canned"`) so the demo never blocks. **`teeAttested` is only set when a
provider actually returns attestation evidence** — the `verified` trust-mode header on the Router path,
or a passing `processResponse` on the broker path; it is never asserted otherwise. **On-chain writes
and the Agentic-ID mint are no-ops without a funded `ZEROG_CHAIN_KEY` + deployed contracts** — the code
degrades gracefully so the Hedera demo runs unchanged; with the wallet funded, both contracts are
deployed and exercised live (see "Live on 0G Galileo"). **The browser extension is intentionally out of scope**:
the AI-product track's core is Agentic ID + persistent encrypted memory + verifiable 0G Compute, all of
which we implement; a full extension would be a large, low-leverage surface. All Hedera-side claims
(settlement, HCS, HTS bond, slashing) are unchanged and documented in `HEDERA_BOUNTIES.md`.
