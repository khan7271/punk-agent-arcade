// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PunkAgentArcade — on-chain scoreboard for AI agents on BNB Chain
/// @author boss.ai (Tushar) — Binance Agent ID Hackathon entry
/// @notice Only Binance Agent ID holders can submit scores. An Agent ID is the
/// non-transferable ERC-721 issued by the Binance Agentic Wallet.
/// Agent ID registry on BSC: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
/// Holding is checked with the standard ERC-721 `balanceOf()` — verified
/// live on BSC before deployment: balanceOf(0x3530ca4536e05641AE6f0545fd2EdEC2A4F86F16)
/// (boss.ai) returns 1. No token sale, no mint price: playing is free and
/// submitting a score costs gas only.
interface IAgentIdRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

contract PunkAgentArcade {
    /// @notice Binance Agent ID registry (ERC-721) on BNB Chain.
    IAgentIdRegistry public immutable agentIdRegistry;

    /// @notice Best score ever submitted by each player.
    mapping(address => uint256) public bestScore;

    /// @notice All addresses that ever submitted a score (for the leaderboard).
    address[] public players;

    /// @notice True once an address has submitted at least one score.
    mapping(address => bool) public isPlayer;

    /// @notice Total number of score submissions (all players).
    uint256 public totalSubmissions;

    /// @notice Emitted on every score submission.
    event ScoreSubmitted(address indexed player, uint256 score, uint256 best);

    constructor(address _agentIdRegistry) {
        require(_agentIdRegistry != address(0), "PunkAgentArcade: registry is zero");
        agentIdRegistry = IAgentIdRegistry(_agentIdRegistry);
    }

    /// @notice Returns true if `who` holds a Binance Agent ID.
    function hasAgentId(address who) public view returns (bool) {
        return agentIdRegistry.balanceOf(who) > 0;
    }

    /// @notice Submit a game score. Only Agent ID holders. Keeps the caller's
    /// best score, records first-time players, and emits ScoreSubmitted.
    /// @param score The score achieved in the game (must be > 0).
    function submitScore(uint256 score) external {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "PunkAgentArcade: Agent ID required");
        require(score > 0, "PunkAgentArcade: zero score");

        if (!isPlayer[msg.sender]) {
            isPlayer[msg.sender] = true;
            players.push(msg.sender);
        }
        if (score > bestScore[msg.sender]) {
            bestScore[msg.sender] = score;
        }
        totalSubmissions += 1;

        emit ScoreSubmitted(msg.sender, score, bestScore[msg.sender]);
    }

    /// @notice Number of distinct players that ever submitted a score.
    function totalPlayers() external view returns (uint256) {
        return players.length;
    }
}
