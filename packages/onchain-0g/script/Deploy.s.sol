// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VerdictRegistry} from "../src/VerdictRegistry.sol";
import {AgentNFT} from "../src/AgentNFT.sol";

/// @notice Deploys both 0G-chain contracts to Galileo. Run:
///   forge script script/Deploy.s.sol --rpc-url $ZEROG_CHAIN_RPC \
///     --private-key $ZEROG_CHAIN_KEY --broadcast
/// Then copy the printed addresses into .env (ZEROG_VERDICT_REGISTRY,
/// ZEROG_AGENT_NFT) and deployments.json (zerogChain block).
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        VerdictRegistry registry = new VerdictRegistry();
        AgentNFT agentNft = new AgentNFT();
        vm.stopBroadcast();
        console.log("VerdictRegistry deployed at:", address(registry));
        console.log("AgentNFT       deployed at:", address(agentNft));
    }
}
