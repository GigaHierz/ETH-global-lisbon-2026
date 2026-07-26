// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerdictRegistry
/// @notice On-chain provenance log for AgentRouter, deployed on 0G Chain (Galileo).
///         AgentRouter routes inference across 0G's hosted models and settles on
///         Hedera; this contract is the 0G-native record of *which model actually
///         served each trade* and the verifier's verdict — the "verification tracked
///         on-chain" leg of the 0G infra track. Anyone can read the full history;
///         each record carries the reporter address and block timestamp.
contract VerdictRegistry {
    struct Verdict {
        string tradeId; // AgentRouter request id (e.g. "req-...")
        string provider; // provider display name
        string model; // advertised model id
        string servedBy; // compute source: "0g" | "groq" | "canned"
        bool teeAttested; // true when the 0G broker returned a verified TEE attestation
        string verdict; // "ok" | "fraud" | "inconclusive"
        address reporter; // who wrote this record (exchange or verifier wallet)
        uint256 timestamp; // block time
    }

    Verdict[] private verdicts;

    event VerdictRecorded(
        uint256 indexed index,
        string tradeId,
        string provider,
        string model,
        string servedBy,
        bool teeAttested,
        string verdict
    );

    /// @notice Append a verdict. Returns its index.
    function recordVerdict(
        string calldata tradeId,
        string calldata provider,
        string calldata model,
        string calldata servedBy,
        bool teeAttested,
        string calldata verdict
    ) external returns (uint256) {
        uint256 index = verdicts.length;
        verdicts.push(
            Verdict(tradeId, provider, model, servedBy, teeAttested, verdict, msg.sender, block.timestamp)
        );
        emit VerdictRecorded(index, tradeId, provider, model, servedBy, teeAttested, verdict);
        return index;
    }

    /// @notice Total verdicts recorded.
    function count() external view returns (uint256) {
        return verdicts.length;
    }

    /// @notice Read a verdict by index.
    function get(uint256 index) external view returns (Verdict memory) {
        return verdicts[index];
    }
}
