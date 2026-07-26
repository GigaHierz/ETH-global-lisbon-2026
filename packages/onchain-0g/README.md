# @agentrouter/onchain-0g

The 0G Chain (Galileo testnet, chain **16602**) contracts — AgentRouter's EVM-native provenance and
identity leg, distinct from the Hedera settlement leg. Solidity is appropriate here because 0G Chain
is EVM (the Hedera side is deliberately no-Solidity). Full track mapping in
[`../../docs/0G_BOUNTIES.md`](../../docs/0G_BOUNTIES.md).

## Contracts

- **`src/VerdictRegistry.sol`** — an append-only on-chain log of per-trade verifier verdicts
  (`recordVerdict(tradeId, provider, model, servedBy, teeAttested, verdict)`). This is the
  "verification tracked on-chain" leg: the exchange records every 0G-served trade and the verifier
  records fraud verdicts. Read at runtime via `viem` from `packages/shared/src/zerog.ts`.
- **`src/AgentNFT.sol`** — a minimal ERC-7857-style Agentic ID. Each token is the buyer agent; its
  `IntelligentData` points at the 0G Storage Merkle root of the agent's AES-256-encrypted memory, so
  owning the token owns the memory. `mint` / `setMemory` / `transferFrom` (tradeable). Minted via
  `mintAgenticId` in `packages/shared/src/zerog.ts`.

## Deploy (Foundry)

Prereqs: [Foundry](https://book.getfoundry.sh/) installed, a **funded** 0G Galileo wallet (faucet
`https://faucet.0g.ai`, 0.1 0G/day is plenty), and the repo `.env` filled in.

```bash
cd packages/onchain-0g
forge install foundry-rs/forge-std   # one-time (adds lib/forge-std)

# Load ZEROG_CHAIN_RPC + ZEROG_CHAIN_KEY from the repo .env, then deploy both:
set -a; source ../../.env; set +a
forge script script/Deploy.s.sol --rpc-url "$ZEROG_CHAIN_RPC" \
  --private-key "$ZEROG_CHAIN_KEY" --broadcast
```

Copy the two printed addresses into:
- **`.env`** → `ZEROG_VERDICT_REGISTRY=…`, `ZEROG_AGENT_NFT=…`
- **`deployments.json`** → `zerogChain.verdictRegistry`, `zerogChain.agentNft`

Verify on the explorer: `https://chainscan-galileo.0g.ai/address/<addr>`.

Once set, the exchange/verifier start mirroring verdicts on-chain automatically, and the agent's
`POST /agentic-id/mint` can mint the Agentic ID. Without these addresses (or a funded key) every 0G
on-chain call is a graceful no-op, so the Hedera demo runs unchanged.
