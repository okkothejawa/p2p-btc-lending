// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {P2PBTCLending} from "../src/P2PBTCLending.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockPriceFeed} from "../test/mocks/MockPriceFeed.sol";

contract DeployP2PBTCLending is Script {
    string public constant COLLATERAL_NAME = "Collateral";
    string public constant COLLATERAL_SYMBOL = "COL";
    uint8 public constant COLLATERAL_DECIMALS = 18;
    int256 public constant BTC_PRICE = 50000e8;
    int256 public constant COLLATERAL_PRICE = 2000e8;

    function run() public {
        vm.startBroadcast();
        
        MockERC20 mockCollateral = new MockERC20(
            COLLATERAL_NAME,
            COLLATERAL_SYMBOL,
            COLLATERAL_DECIMALS
        );
        address collateralToken = address(mockCollateral);
        address recipient = msg.sender;
        uint256 mintAmount = type(uint256).max;
        mockCollateral.mint(recipient, mintAmount);        
        MockPriceFeed mockBtcPriceFeed = new MockPriceFeed();
        mockBtcPriceFeed.setPrice(BTC_PRICE);
        address btcPriceFeed = address(mockBtcPriceFeed);        
        MockPriceFeed mockCollateralPriceFeed = new MockPriceFeed();
        mockCollateralPriceFeed.setPrice(COLLATERAL_PRICE);
        address collateralPriceFeed = address(mockCollateralPriceFeed);        
        // Deploy main contract
        P2PBTCLending lendingContract = new P2PBTCLending(
            collateralToken,
            collateralPriceFeed,
            btcPriceFeed
        );
        mockCollateral.approve(address(lendingContract), mintAmount);
        vm.stopBroadcast();
    }
}