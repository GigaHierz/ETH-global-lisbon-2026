# 0G on-chain proof — AgentRouter (0G Galileo testnet, chain 16602)

Live explorer links for everything the 0G integration deployed and executed on **0G Galileo**
(chain `16602`), explorer **https://chainscan-galileo.0g.ai**. Full track mapping in
[0G_BOUNTIES.md](0G_BOUNTIES.md); integration code is referenced by `file:line` there.

Deployer / agent wallet:
[`0x1724707c52de2fa65ad9c586b5d38507f52D3c06`](https://chainscan-galileo.0g.ai/address/0x1724707c52de2fa65ad9c586b5d38507f52D3c06)

## Contracts (`packages/onchain-0g`)

| Contract | Address | Deploy tx |
|---|---|---|
| **VerdictRegistry** — on-chain verification log (`packages/onchain-0g/src/VerdictRegistry.sol`) | [`0x5b7da2E9…269eE`](https://chainscan-galileo.0g.ai/address/0x5b7da2E9432E3A3c3C26cA8B30d0BcafF2A269eE) | [`0x0a6d7162…42cde`](https://chainscan-galileo.0g.ai/tx/0x0a6d71624f06af487beaaa94a8be5d30d10ccfed6a0934d31ffbe999fe842cde) |
| **AgentNFT** — ERC-7857-style Agentic ID (`packages/onchain-0g/src/AgentNFT.sol`) | [`0x85ff2BC0…5875D`](https://chainscan-galileo.0g.ai/address/0x85ff2BC072cBfec881A13bC04E7cbaf79ad5875D) | [`0xd709b2e3…11573`](https://chainscan-galileo.0g.ai/tx/0xd709b2e38c03ba6a17663d90ca901064dee6531d74cceda115009e5887e11573) |
| **ERC-8004 IdentityRegistry** — 0G's live registry (optional discoverability path) | [`0x8004A818…4BD9e`](https://chainscan-galileo.0g.ai/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | *(deployed by 0G)* |

## Infra track — verification tracked on 0G Chain (`VerdictRegistry`)

`count() == 6`. Every 0G-served trade and every verifier verdict is written on-chain. The last one
was written **by the running verifier service during `pnpm demo`**, not a script — proving the live
wiring (`packages/verifier/src/index.ts` → `recordVerdictOnZeroG`, `packages/shared/src/zerog.ts`).

| # | Verdict | Provider | servedBy | teeAttested | Tx |
|---|---|---|---|---|---|
| 1 | ok | NimbusAI | 0g | ✓ | [`0xc70e5f8b…`](https://chainscan-galileo.0g.ai/tx/0xc70e5f8b48aa81d7f14bf9d9b7653556d94c30bdb36c5c09e830f4046dcf97af) |
| 2 | ok | NimbusAI | 0g | ✓ | [`0xf0cc0a4a…`](https://chainscan-galileo.0g.ai/tx/0xf0cc0a4adc9cd0ceba2edaf37185b0cb09bd721959506fe07a718bd675259a06) |
| 3 | fraud | SketchyGPU Labs | groq | – | [`0x9cca72a8…`](https://chainscan-galileo.0g.ai/tx/0x9cca72a816d31c24f527b94b285a4748811ce52017b77324495c8cc05435f1a8) |
| 4 | ok | NimbusAI | 0g | ✓ | [`0x97e2180b…`](https://chainscan-galileo.0g.ai/tx/0x97e2180bca3b11dc9796dccabac4c68cd63b782ada773edb7404f8a89b1cea86) |
| 5 | fraud | SketchyGPU Labs | groq | – | [`0x4175e633…`](https://chainscan-galileo.0g.ai/tx/0x4175e6330815695a16ba52d8042a56a2a3ab58cb012fe4b32a073629dd4d1109) |
| 6 | fraud | SketchyGPU Labs | canned | – | [`0x2466cea0…`](https://chainscan-galileo.0g.ai/tx/0x2466cea092342960ffe20dbfd00a8789569b43b973901431a85594d926492119) *(← live `pnpm demo` verifier)* |

## AI Product track — Agentic ID + tradeable 0G Storage memory (`AgentNFT`)

Three Agentic IDs minted; each token's `intelligentData.dataHash` is the 0G Storage root of its
AES-256-encrypted memory (`packages/agent/src/memory-0g.ts`, `mintAgenticId` in
`packages/shared/src/zerog.ts`).

| Token | Owner | Mint tx |
|---|---|---|
| **#1** (memory re-pointed via `setMemory`) | deployer wallet | [`0xc396750b…`](https://chainscan-galileo.0g.ai/tx/0xc396750b764375f58d988e7f4b2faca96fa1cae54ea170d247e7ebe874190994) |
| #2 | deployer wallet | [`0xca5df3fe…`](https://chainscan-galileo.0g.ai/tx/0xca5df3fe2f3c75f36841d7400cd235e2696f0e9c5eff52979045b4fa6d7890ba) |
| #3 | deployer wallet | [`0xc3df7a85…`](https://chainscan-galileo.0g.ai/tx/0xc3df7a85c67b50e568075a0f0294a8c3027727600eca2d509a5e6750ee71a5ab) |

**Tradeable memory in action** — token #1's memory pointer was updated on-chain (`setMemory`):
[`0xf632e0ed…`](https://chainscan-galileo.0g.ai/tx/0xf632e0edbf7b7e66ee2bd9f7322ab100afb255dfe556aff03f522560c89ebf13).

**0G Storage uploads** (AES-256-encrypted memory, Merkle-rooted):

| Memory root | Upload tx |
|---|---|
| `0xf8574891003798aefed350a05e4027a29bba0eebdcd79f3bef4a6c1b920f778b` (token #1 initial) | [`0xb9ff7d90…`](https://chainscan-galileo.0g.ai/tx/0xb9ff7d904394fa397ea48c4ac256f0aeba987fa08b75e3c7ab5d99da6b8abce9) |
| `0xade7e7247e3d140cce03324e21a394f81c1217dc5943e91fefd3262f27c551f0` (token #1 re-pointed) | [`0xe20c6dcd…`](https://chainscan-galileo.0g.ai/tx/0xe20c6dcd39308356faab1be8c04e16493150e40a56df50add3195f934bd24077) |

## 0G Compute — TEE-attested inference (off-chain, OpenAI-compatible)

Served through `packages/provider/src/backends/zerog.ts` (Router `router-api.0g.ai/v1`,
`X-0G-Provider-Trust-Mode: verified`). A live call returned `servedBy: "0g"`,
`upstreamModel: "0gm-1.0-35b-a3b"`, `teeAttested: true`, with an `attestationRef` captured from the
router's `ZG-Res-Key` header and carried into the trade record + the on-chain verdicts above.

---

*Addresses also in [`../deployments.json`](../deployments.json) (`zerogChain`). Re-deploy with
`forge script script/Deploy.s.sol` — see [`../packages/onchain-0g/README.md`](../packages/onchain-0g/README.md).*
