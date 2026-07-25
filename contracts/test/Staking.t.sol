// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Staking} from "../src/Staking.sol";

contract StakingTest is Test {
    Staking s;
    address verifier = address(0xAB);
    address provider = address(0xCD);
    address provider2 = address(0xEF);

    event Staked(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 amount);

    function setUp() public {
        s = new Staking(verifier);
        vm.deal(provider, 10 ether);
        vm.deal(provider2, 10 ether);
    }

    function test_constructor_sets_verifier() public view {
        assertEq(s.verifier(), verifier);
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

    function test_stake_reverts_on_zero_value() public {
        vm.prank(provider);
        vm.expectRevert("no value");
        s.stake{value: 0}();
    }

    function test_stake_is_additive() public {
        vm.startPrank(provider);
        s.stake{value: 0.3 ether}();
        s.stake{value: 0.2 ether}();
        vm.stopPrank();
        assertEq(s.getStake(provider), 0.5 ether);
    }

    function test_stake_emits_event() public {
        vm.expectEmit(true, false, false, true);
        emit Staked(provider, 0.4 ether);
        vm.prank(provider);
        s.stake{value: 0.4 ether}();
    }

    function test_slash_caps_at_stake_and_accounts_the_cut() public {
        vm.prank(provider);
        s.stake{value: 0.1 ether}();
        vm.prank(verifier);
        s.slash(provider, 1 ether); // asks for more than staked
        assertEq(s.getStake(provider), 0);
        assertEq(s.totalSlashed(), 0.1 ether); // only the capped cut is accounted
    }

    function test_slash_emits_capped_amount() public {
        vm.prank(provider);
        s.stake{value: 0.1 ether}();
        vm.expectEmit(true, false, false, true);
        emit Slashed(provider, 0.1 ether); // capped, not the requested 1 ether
        vm.prank(verifier);
        s.slash(provider, 1 ether);
    }

    function test_totalSlashed_accumulates_across_providers() public {
        vm.prank(provider);
        s.stake{value: 1 ether}();
        vm.prank(provider2);
        s.stake{value: 1 ether}();

        vm.startPrank(verifier);
        s.slash(provider, 0.3 ether);
        s.slash(provider2, 0.5 ether);
        vm.stopPrank();

        assertEq(s.totalSlashed(), 0.8 ether);
        assertEq(s.getStake(provider), 0.7 ether);
        assertEq(s.getStake(provider2), 0.5 ether);
    }

    function test_only_verifier_slashes() public {
        vm.expectRevert("not verifier");
        s.slash(provider, 1);
    }

    function testFuzz_slash_never_exceeds_stake(uint96 stakeAmt, uint96 slashAmt) public {
        vm.assume(stakeAmt > 0);
        vm.deal(provider, stakeAmt);
        vm.prank(provider);
        s.stake{value: stakeAmt}();

        vm.prank(verifier);
        s.slash(provider, slashAmt);

        uint256 expectedCut = slashAmt > stakeAmt ? stakeAmt : slashAmt;
        assertEq(s.getStake(provider), uint256(stakeAmt) - expectedCut);
        assertEq(s.totalSlashed(), expectedCut);
    }
}
