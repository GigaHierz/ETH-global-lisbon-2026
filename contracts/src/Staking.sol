// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Staking — minimal provider-stake + slash for AgentRouter (hackathon MVP).
/// Providers stake native ETH as skin-in-the-game; the verifier slashes cheaters.
contract Staking {
    address public verifier;
    mapping(address => uint256) private stakes;
    uint256 public totalSlashed;

    event Staked(address indexed agent, uint256 amount);
    event Slashed(address indexed agent, uint256 amount);

    modifier onlyVerifier() {
        require(msg.sender == verifier, "not verifier");
        _;
    }

    constructor(address _verifier) {
        verifier = _verifier;
    }

    function stake() external payable {
        require(msg.value > 0, "no value");
        stakes[msg.sender] += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    function slash(address agent, uint256 amount) external onlyVerifier {
        uint256 s = stakes[agent];
        uint256 cut = amount > s ? s : amount;
        stakes[agent] = s - cut;
        totalSlashed += cut;
        emit Slashed(agent, cut);
        // Slashed funds stay in the contract (burned for MVP purposes).
    }

    function getStake(address agent) external view returns (uint256) {
        return stakes[agent];
    }
}
