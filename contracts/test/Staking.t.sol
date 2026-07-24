// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Staking} from "../src/Staking.sol";

contract StakingTest is Test {
    Staking s;
    address verifier = address(0xAB);
    address provider = address(0xCD);

    function setUp() public {
        s = new Staking(verifier);
        vm.deal(provider, 1 ether);
    }

    function test_stake_slash_flow() public {
        vm.prank(provider);
        s.stake{value: 0.5 ether}();
        assertEq(s.getStake(provider), 0.5 ether);

        vm.prank(verifier);
        s.slash(provider, 0.2 ether);
        assertEq(s.getStake(provider), 0.3 ether);
        assertEq(s.totalSlashed(), 0.2 ether);
    }

    function test_slash_caps_at_stake() public {
        vm.prank(provider);
        s.stake{value: 0.1 ether}();
        vm.prank(verifier);
        s.slash(provider, 1 ether);
        assertEq(s.getStake(provider), 0);
    }

    function test_only_verifier_slashes() public {
        vm.expectRevert("not verifier");
        s.slash(provider, 1);
    }
}
