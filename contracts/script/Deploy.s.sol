// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {Staking} from "../src/Staking.sol";

/// Deploys Staking with VERIFIER address, then run scripts/write-deployments.sh
/// (or the pnpm deploy task) to persist the address into /deployments.json.
contract Deploy is Script {
    function run() external {
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        vm.startBroadcast();
        Staking staking = new Staking(verifier);
        vm.stopBroadcast();
        console.log("STAKING_ADDRESS=%s", address(staking));
    }
}
