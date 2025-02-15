// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console2} from "forge-std/Test.sol";
import {P2PBTCLending} from "../src/P2PBTCLending.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract P2PBTCLendingTest is Test {
    P2PBTCLending public lending;
    MockERC20 public collateralToken;
    MockPriceFeed public btcPriceFeed;
    MockPriceFeed public collateralPriceFeed;

    address public borrower = address(0x1);
    int256 public constant BTC_PRICE = 50000e8; // $50,000 per BTC
    int256 public constant COLLATERAL_PRICE = 2000e8; // $2,000 per token
    uint256 public constant BORROW_AMOUNT = 1e8; // 1 BTC
    uint256 public constant INTEREST_RATE = 500; // 5% APR
    bytes public constant BTC_ADDRESS = hex"00141234567890abcdef1234567890abcdef1234";
    bytes public constant SIGNED_PSBT = hex"70736274ff01009a020000000258e87a21b56daf0c23be8e7070456c336f7cbaa5c8757924f545887bb2abdd750000000000ffffffff838d0427d0ec650a68aa46bb0b098aea4422c071b2ca78352a077959d07cea1d0100000000ffffffff0270aaf00800000000160014d85c2b71d0060b09c9886aeb815e50991dda124d00e1f5050000000016001400aea9a2e5f0f876a588df5546e8742d1d87008f000000000000000000";

    function setUp() public {
        // Deploy mock tokens and price feeds
        collateralToken = new MockERC20("Collateral", "COL", 18);
        btcPriceFeed = new MockPriceFeed();
        collateralPriceFeed = new MockPriceFeed();

        // Set initial prices
        btcPriceFeed.setPrice(BTC_PRICE);
        collateralPriceFeed.setPrice(COLLATERAL_PRICE);

        // Deploy lending contract
        lending = new P2PBTCLending(
            address(collateralToken),
            address(collateralPriceFeed),
            address(btcPriceFeed)
        );

        // Setup borrower with collateral
        uint256 requiredCollateral = lending.getCollateralAmount(BORROW_AMOUNT);
        collateralToken.mint(borrower, requiredCollateral);

        vm.startPrank(borrower);
        collateralToken.approve(address(lending), requiredCollateral);
    }

    function test_RequestBorrow() public {
        vm.startPrank(borrower);

        // Get required collateral amount
        uint256 requiredCollateral = lending.getCollateralAmount(BORROW_AMOUNT);

        // Initial balances
        uint256 initialBorrowerBalance = collateralToken.balanceOf(borrower);
        uint256 initialContractBalance = collateralToken.balanceOf(address(lending));

        // Create borrow request
        lending.requestBorrow(BORROW_AMOUNT, INTEREST_RATE, BTC_ADDRESS, SIGNED_PSBT);

        // Verify collateral transfer
        assertEq(
            collateralToken.balanceOf(borrower),
            initialBorrowerBalance - requiredCollateral,
            "Incorrect borrower balance after collateral transfer"
        );
        assertEq(
            collateralToken.balanceOf(address(lending)),
            initialContractBalance + requiredCollateral,
            "Incorrect contract balance after collateral transfer"
        );

        // Verify borrow request details
        (
            uint256 amount,
            uint256 collateral,
            uint256 interestRate,
            bytes memory btcAddress,
            bytes memory signedPsbt,
            bool active
        ) = lending.borrowRequests(borrower);

        assertEq(amount, BORROW_AMOUNT, "Incorrect borrow amount");
        assertEq(collateral, requiredCollateral, "Incorrect collateral amount");
        assertEq(interestRate, INTEREST_RATE, "Incorrect interest rate");
        assertEq(keccak256(btcAddress), keccak256(BTC_ADDRESS), "Incorrect BTC address");
        assertEq(keccak256(signedPsbt), keccak256(SIGNED_PSBT), "Incorrect PSBT");
        assertTrue(active, "Borrow request should be active");

        vm.stopPrank();
    }

    function test_RequestBorrow_InsufficientCollateral() public {
        vm.startPrank(borrower);

        // Get required collateral amount
        uint256 requiredCollateral = lending.getCollateralAmount(BORROW_AMOUNT);

        // Reduce allowance to less than required
        collateralToken.approve(address(lending), requiredCollateral - 1);

        // Attempt to create borrow request with insufficient collateral
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("ERC20InsufficientAllowance(address,uint256,uint256)")),
                address(lending),
                requiredCollateral - 1,
                requiredCollateral
            )
        );
        lending.requestBorrow(BORROW_AMOUNT, INTEREST_RATE, BTC_ADDRESS, SIGNED_PSBT);

        vm.stopPrank();
    }

    function test_RequestBorrow_ExistingRequest() public {
        vm.startPrank(borrower);

        // Create first borrow request
        lending.requestBorrow(BORROW_AMOUNT, INTEREST_RATE, BTC_ADDRESS, SIGNED_PSBT);

        // Attempt to create second borrow request
        vm.expectRevert("Active borrow request exists");
        lending.requestBorrow(BORROW_AMOUNT, INTEREST_RATE, BTC_ADDRESS, SIGNED_PSBT);

        vm.stopPrank();
    }

    function test_RequestBorrow_InvalidAmount() public {
        vm.startPrank(borrower);

        // Attempt to create borrow request with zero amount
        vm.expectRevert("Amount must be greater than 0");
        lending.requestBorrow(0, INTEREST_RATE, BTC_ADDRESS, SIGNED_PSBT);

        vm.stopPrank();
    }

    function test_RequestBorrow_InvalidBtcAddress() public {
        vm.startPrank(borrower);

        // Attempt to create borrow request with empty BTC address
        vm.expectRevert("Invalid BTC address");
        lending.requestBorrow(BORROW_AMOUNT, INTEREST_RATE, "", SIGNED_PSBT);

        vm.stopPrank();
    }
} 