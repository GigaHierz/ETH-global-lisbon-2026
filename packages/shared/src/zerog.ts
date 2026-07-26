// 0G Chain (Galileo testnet) integration — the on-chain provenance leg.
//
// AgentRouter's economic loop settles on Hedera; this module adds the 0G-track
// requirement of "verification tracked on-chain" on 0G itself. It writes each
// settled/attested trade's verdict to a VerdictRegistry contract on 0G Galileo.
//
// Everything here is gated on a funded ZEROG_CHAIN_KEY + a deployed
// ZEROG_VERDICT_REGISTRY. With neither, every call is a no-op that returns null,
// so the existing Hedera-only demo runs unchanged (same discipline as the 0G
// Compute canned fallback). Uses viem (the repo's EVM client) — no ethers here.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { log } from "./index.js";

const ZEROG_CHAIN_ID = Number(process.env.ZEROG_CHAIN_ID || "16602");
const ZEROG_CHAIN_RPC = process.env.ZEROG_CHAIN_RPC || "https://evmrpc-testnet.0g.ai";
const ZEROG_EXPLORER = process.env.ZEROG_EXPLORER || "https://chainscan-galileo.0g.ai";

/** 0G Galileo testnet, defined for viem. */
export const zeroGGalileo = defineChain({
  id: ZEROG_CHAIN_ID,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [ZEROG_CHAIN_RPC] } },
  blockExplorers: { default: { name: "0G Chainscan", url: ZEROG_EXPLORER } },
  testnet: true,
});

/** Minimal ABI for our VerdictRegistry (see packages/onchain-0g). */
export const VERDICT_REGISTRY_ABI = [
  {
    type: "function",
    name: "recordVerdict",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tradeId", type: "string" },
      { name: "provider", type: "string" },
      { name: "model", type: "string" },
      { name: "servedBy", type: "string" },
      { name: "teeAttested", type: "bool" },
      { name: "verdict", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "VerdictRecorded",
    inputs: [
      { name: "index", type: "uint256", indexed: true },
      { name: "tradeId", type: "string", indexed: false },
      { name: "provider", type: "string", indexed: false },
      { name: "model", type: "string", indexed: false },
      { name: "servedBy", type: "string", indexed: false },
      { name: "teeAttested", type: "bool", indexed: false },
      { name: "verdict", type: "string", indexed: false },
    ],
  },
  {
    type: "function",
    name: "count",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function chainKey(): Hex | null {
  const k = process.env.ZEROG_CHAIN_KEY?.trim();
  if (!k) return null;
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

function registryAddress(): Hex | null {
  const a = process.env.ZEROG_VERDICT_REGISTRY?.trim();
  return a && a.startsWith("0x") ? (a as Hex) : null;
}

/** True when both a funded key and a deployed registry are configured. */
export function zeroGChainEnabled(): boolean {
  return chainKey() !== null && registryAddress() !== null;
}

/** Human explorer link for a tx hash. */
export function zeroGTxLink(hash: string): string {
  return `${ZEROG_EXPLORER}/tx/${hash}`;
}

export interface VerdictRecord {
  tradeId: string;
  provider: string;
  model: string;
  servedBy: string;
  teeAttested: boolean;
  verdict: "ok" | "fraud" | "inconclusive";
}

/**
 * Record a trade verdict on 0G Chain. No-op (returns null) unless a funded
 * ZEROG_CHAIN_KEY and a deployed ZEROG_VERDICT_REGISTRY are both present.
 * Returns the tx hash on success. Never throws into the caller — logs and
 * swallows so on-chain-0G availability can never break settlement.
 */
export async function recordVerdictOnZeroG(rec: VerdictRecord): Promise<string | null> {
  const key = chainKey();
  const registry = registryAddress();
  if (!key || !registry) return null;
  try {
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain: zeroGGalileo, transport: http(ZEROG_CHAIN_RPC) });
    const hash = await wallet.writeContract({
      address: registry,
      abi: VERDICT_REGISTRY_ABI,
      functionName: "recordVerdict",
      args: [rec.tradeId, rec.provider, rec.model, rec.servedBy, rec.teeAttested, rec.verdict],
    });
    log("0g-chain", `verdict '${rec.verdict}' for ${rec.provider} recorded on 0G ${hash.slice(0, 18)}…`);
    return hash;
  } catch (e) {
    log("0g-chain", `verdict record skipped (${(e as Error).message.slice(0, 100)})`);
    return null;
  }
}

/** Read-only client for the registry (used by scripts / verification). */
export function zeroGPublicClient() {
  return createPublicClient({ chain: zeroGGalileo, transport: http(ZEROG_CHAIN_RPC) });
}

// ─── Agentic ID (ERC-7857-style AgentNFT, see packages/onchain-0g) ────────────

/** Minimal ABI for our AgentNFT Agentic ID. */
export const AGENT_NFT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dataDescription", type: "string" },
      { name: "dataHash", type: "bytes32" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setMemory",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "dataDescription", type: "string" },
      { name: "dataHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "intelligentData",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "dataDescription", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "Minted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "dataDescription", type: "string", indexed: false },
      { name: "dataHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

function agentNftAddress(): Hex | null {
  const a = process.env.ZEROG_AGENT_NFT?.trim();
  return a && a.startsWith("0x") ? (a as Hex) : null;
}

/** True when a funded key and a deployed AgentNFT are both configured. */
export function agenticIdEnabled(): boolean {
  return chainKey() !== null && agentNftAddress() !== null;
}

/** A 0G Storage root → bytes32; keccak-fold anything that isn't already 32 bytes. */
function toBytes32(root: string): Hex {
  const h = (root.startsWith("0x") ? root : `0x${root}`) as string;
  return /^0x[0-9a-fA-F]{64}$/.test(h) ? (h as Hex) : keccak256(toHex(root));
}

/** Explorer link for a token on the AgentNFT contract. */
export function agenticIdLink(): string | null {
  const nft = agentNftAddress();
  return nft ? `${ZEROG_EXPLORER}/token/${nft}` : null;
}

export interface MintedAgenticId {
  txHash: string;
  tokenId: string | null;
  contract: string;
  explorer: string;
}

/**
 * Mint an Agentic ID whose intelligent-data points at the agent's encrypted
 * memory in 0G Storage. No-op (null) unless a funded ZEROG_CHAIN_KEY and a
 * deployed ZEROG_AGENT_NFT are both present. Never throws into the caller.
 */
export async function mintAgenticId(opts: {
  description: string;
  memoryRoot: string;
  to?: Hex;
}): Promise<MintedAgenticId | null> {
  const key = chainKey();
  const nft = agentNftAddress();
  if (!key || !nft) return null;
  try {
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain: zeroGGalileo, transport: http(ZEROG_CHAIN_RPC) });
    const pub = zeroGPublicClient();
    const to = opts.to ?? account.address;
    const hash = await wallet.writeContract({
      address: nft,
      abi: AGENT_NFT_ABI,
      functionName: "mint",
      args: [opts.description, toBytes32(opts.memoryRoot), to],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const events = parseEventLogs({ abi: AGENT_NFT_ABI, eventName: "Minted", logs: receipt.logs });
    const tokenId = events[0]?.args?.tokenId?.toString() ?? null;
    log("0g-chain", `Agentic ID minted (token ${tokenId ?? "?"}) ${hash.slice(0, 18)}…`);
    return { txHash: hash, tokenId, contract: nft, explorer: `${ZEROG_EXPLORER}/tx/${hash}` };
  } catch (e) {
    log("0g-chain", `Agentic ID mint skipped (${(e as Error).message.slice(0, 120)})`);
    return null;
  }
}

/** Update an Agentic ID's memory pointer to a new 0G Storage root. */
export async function updateAgenticIdMemory(tokenId: string, description: string, memoryRoot: string): Promise<string | null> {
  const key = chainKey();
  const nft = agentNftAddress();
  if (!key || !nft) return null;
  try {
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain: zeroGGalileo, transport: http(ZEROG_CHAIN_RPC) });
    const hash = await wallet.writeContract({
      address: nft,
      abi: AGENT_NFT_ABI,
      functionName: "setMemory",
      args: [BigInt(tokenId), description, toBytes32(memoryRoot)],
    });
    log("0g-chain", `Agentic ID ${tokenId} memory updated ${hash.slice(0, 18)}…`);
    return hash;
  } catch (e) {
    log("0g-chain", `Agentic ID memory update skipped (${(e as Error).message.slice(0, 120)})`);
    return null;
  }
}
