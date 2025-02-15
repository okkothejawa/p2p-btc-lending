// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "../../src/interfaces/AggregatorV3Interface.sol";

contract MockPriceFeed is AggregatorV3Interface {
    int256 private _price;
    uint8 private constant _decimals = 8;

    function setPrice(int256 price) external {
        _price = price;
    }

    function decimals() external pure returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "Mock Price Feed";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }
} 