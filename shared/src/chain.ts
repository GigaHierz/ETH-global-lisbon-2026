import { createPublicClient, createWalletClient, http, parseAbi, type Account } from "viem";
import { baseSepolia } from "viem/chains";

export const CHAIN = baseSepolia;
export const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
export const NETWORK_CAIP2 = "eip155:84532";
export const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";

// Canonical Circle testnet USDC on Base Sepolia
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

// Official ERC-8004 reference deployments on Base Sepolia (verified live, see RESEARCH.md)
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

export const stakingAbi = parseAbi([
  "function stake() external payable",
  "function slash(address agent, uint256 amount) external",
  "function getStake(address agent) external view returns (uint256)",
  "event Staked(address indexed agent, uint256 amount)",
  "event Slashed(address indexed agent, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

export function publicClient() {
  return createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
}

export function walletClient(account: Account) {
  return createWalletClient({ chain: CHAIN, transport: http(RPC_URL), account });
}
