// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentNFT — minimal ERC-7857-style Agentic ID for AgentRouter.
/// @notice Each token is an AI agent whose "intelligent data" is a pointer to its
///         encrypted memory in 0G Storage (the Merkle root hash). Ownership is
///         transferable, so the agent — and the memory it points at — is tradeable.
///         Full ERC-7857 privacy-preserving transfer needs a TEE/ZKP re-encryption
///         oracle; this keeps the mint + ownership + memory-pointer semantics the
///         demo trades on. See docs/0G_BOUNTIES.md (truthfulness note).
contract AgentNFT {
    struct IntelligentData {
        string dataDescription; // human/URI description of the agent + memory
        bytes32 dataHash; // 0G Storage root hash of the encrypted memory
    }

    string public constant name = "AgentRouter Agentic ID";
    string public constant symbol = "ARID";

    uint256 public totalSupply;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public creatorOf;
    mapping(uint256 => IntelligentData) private _data;

    event Minted(uint256 indexed tokenId, address indexed to, string dataDescription, bytes32 dataHash);
    event MemoryUpdated(uint256 indexed tokenId, bytes32 oldHash, bytes32 newHash);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /// @notice Mint an Agentic ID pointing at 0G Storage memory. Permissionless.
    function mint(string calldata dataDescription, bytes32 dataHash, address to)
        external
        returns (uint256 tokenId)
    {
        require(to != address(0), "zero to");
        tokenId = ++totalSupply;
        ownerOf[tokenId] = to;
        creatorOf[tokenId] = msg.sender;
        _data[tokenId] = IntelligentData(dataDescription, dataHash);
        emit Minted(tokenId, to, dataDescription, dataHash);
        emit Transfer(address(0), to, tokenId);
    }

    /// @notice Re-point the agent's memory (new 0G Storage root as it learns more).
    function setMemory(uint256 tokenId, string calldata dataDescription, bytes32 dataHash) external {
        require(ownerOf[tokenId] == msg.sender, "not owner");
        bytes32 old = _data[tokenId].dataHash;
        _data[tokenId] = IntelligentData(dataDescription, dataHash);
        emit MemoryUpdated(tokenId, old, dataHash);
    }

    /// @notice Transfer the agent (and its memory pointer) — tradeable ownership.
    function transferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from, "not owner");
        require(msg.sender == from, "not authorized");
        require(to != address(0), "zero to");
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    /// @notice Read the agent's intelligent-data (memory pointer).
    function intelligentData(uint256 tokenId) external view returns (IntelligentData memory) {
        return _data[tokenId];
    }
}
