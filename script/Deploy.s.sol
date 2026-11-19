// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/PunkAgentArcade.sol";

/// @notice Deploy PunkAgentArcade to BNB Chain.
/// Usage (from the repo root, with a funded deployer key in .env as PRIVATE_KEY):
///   forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.bnbchain.org \
///     --broadcast --verify --etherscan-api-key $BSCSCAN_API_KEY
contract DeployPunkAgentArcade is Script {
    /// Binance Agent ID registry (ERC-721) on BSC mainnet.
    address constant AGENT_ID_REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    function run() external {
        vm.startBroadcast();
        PunkAgentArcade arcade = new PunkAgentArcade(AGENT_ID_REGISTRY);
        vm.stopBroadcast();
        console.log("PunkAgentArcade deployed at:", address(arcade));
        console.log("Agent ID registry:", AGENT_ID_REGISTRY);
    }
}
