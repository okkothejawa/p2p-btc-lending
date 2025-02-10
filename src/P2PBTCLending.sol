// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "./IBitcoinLightClient.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "bitcoin-spv/solidity/contracts/ValidateSPV.sol";
import "bitcoin-spv/solidity/contracts/BTCUtils.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract P2PBTCLending is ReentrancyGuard {
    IBitcoinLightClient public lightClient = IBitcoinLightClient(address(0x3100000000000000000000000000000000000001));
    IERC20 public immutable collateralToken;
    AggregatorV3Interface public immutable collateralPriceFeed;
    AggregatorV3Interface public immutable btcPriceFeed;

    uint256 public constant COLLATERAL_RATIO = 150; // 150% collateral required
    uint256 public constant LIQUIDATION_THRESHOLD = 125; // 125% liquidation threshold
    uint256 public constant LIQUIDATION_BONUS = 5; // 5% bonus for liquidators
    uint256 public constant SECONDS_PER_YEAR = 31536000;

    struct BorrowRequest {
        uint256 amount;
        uint256 collateral;
        uint256 interestRate;
        bytes btcAddress;
        bool active;
    }

    struct Loan {
        uint256 borrowAmount;
        uint256 principal;
        uint256 interestRate;
        uint256 startDate;
        address borrower;
        address lender;
        bytes btcAddress;
        bool active;
    }

    mapping(address => BorrowRequest) public borrowRequests;
    mapping(address => mapping(address => Loan)) public loans;

    event BorrowRequestCreated(address indexed borrower, uint256 amount, uint256 interestRate, bytes btcAddress);
    event BorrowRequestCancelled(address indexed borrower);
    event LoanCreated(address indexed borrower, address indexed lender, uint256 amount, uint256 interestRate);
    event LoanRepaid(address indexed borrower, address indexed lender, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event LoanLiquidated(address indexed borrower, address indexed liquidator, uint256 amount);

    constructor(
        address _collateralToken,
        address _collateralPriceFeed,
        address _btcPriceFeed
    ) {
        collateralToken = IERC20(_collateralToken);
        collateralPriceFeed = AggregatorV3Interface(_collateralPriceFeed);
        btcPriceFeed = AggregatorV3Interface(_btcPriceFeed);
    }

    function requestBorrow(uint256 amount, uint256 interestRate, bytes memory btcAddress) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(btcAddress.length > 0, "Invalid BTC address");
        require(!borrowRequests[msg.sender].active, "Active borrow request exists");
        
        uint256 collateralAmount = getCollateralAmount(amount);
        require(collateralToken.transferFrom(msg.sender, address(this), collateralAmount), "Collateral transfer failed");

        borrowRequests[msg.sender] = BorrowRequest({
            amount: amount,
            collateral: collateralAmount,
            interestRate: interestRate,
            btcAddress: btcAddress,
            active: true
        });

        emit BorrowRequestCreated(msg.sender, amount, interestRate, btcAddress);
    }

    function cancelBorrowRequest() external nonReentrant {
        BorrowRequest memory request = borrowRequests[msg.sender];
        require(request.active, "No active borrow request");
        require(collateralToken.transfer(msg.sender, request.collateral), "Collateral return failed");
        delete borrowRequests[msg.sender];
        emit BorrowRequestCancelled(msg.sender);
    }

    function lend(address borrower) external nonReentrant {
        BorrowRequest memory request = borrowRequests[borrower];
        require(request.active, "No active borrow request");
        require(!loans[msg.sender][borrower].active, "Loan already exists");

        loans[msg.sender][borrower] = Loan({
            borrowAmount: request.amount,
            principal: request.amount,
            interestRate: request.interestRate,
            startDate: block.timestamp,
            borrower: borrower,
            lender: msg.sender,
            btcAddress: request.btcAddress,
            active: true
        });

        delete borrowRequests[borrower];
        emit LoanCreated(borrower, msg.sender, request.amount, request.interestRate);
    }

    function repay(address lender) external nonReentrant {
        Loan storage loan = loans[lender][msg.sender];
        require(loan.active, "No active loan");

        uint256 interest = calculateInterest(loan);
        uint256 totalRepayment = loan.principal + interest;
        
        // Verify BTC payment using light client
        // This would require integration with the Bitcoin light client to verify the payment
        // Implementation depends on the specific light client interface

        uint256 collateralAmount = getCollateralAmount(loan.borrowAmount);
        require(collateralToken.transfer(msg.sender, collateralAmount), "Collateral return failed");

        loan.active = false;
        emit LoanRepaid(msg.sender, lender, totalRepayment);
    }

    function liquidate(address borrower, address lender) external nonReentrant {
        Loan storage loan = loans[lender][borrower];
        require(loan.active, "No active loan");
        
        uint256 collateralAmount = getCollateralAmount(loan.borrowAmount);
        uint256 currentCollateralValue = getCurrentCollateralValue(collateralAmount);
        uint256 currentLoanValue = getCurrentLoanValue(loan);
        
        require(currentCollateralValue * 100 < currentLoanValue * LIQUIDATION_THRESHOLD, "Cannot liquidate");
        
        uint256 liquidatorReward = (collateralAmount * LIQUIDATION_BONUS) / 100;
        uint256 remainingCollateral = collateralAmount - liquidatorReward;
        
        require(collateralToken.transfer(msg.sender, liquidatorReward), "Liquidator reward transfer failed");
        require(collateralToken.transfer(lender, remainingCollateral), "Remaining collateral transfer failed");
        
        loan.active = false;
        emit LoanLiquidated(borrower, msg.sender, collateralAmount);
    }

    function getCollateralAmount(uint256 amount) public view returns (uint256) {
        (, int256 btcPrice,,,) = btcPriceFeed.latestRoundData();
        (, int256 collateralPrice,,,) = collateralPriceFeed.latestRoundData();
        
        require(btcPrice > 0 && collateralPrice > 0, "Invalid price data");
        
        // Calculate required collateral with 150% overcollateralization
        uint256 requiredCollateral = (amount * uint256(btcPrice) * COLLATERAL_RATIO) / (uint256(collateralPrice) * 100);
        return requiredCollateral;
    }

    function getCurrentCollateralValue(uint256 collateralAmount) public view returns (uint256) {
        (, int256 collateralPrice,,,) = collateralPriceFeed.latestRoundData();
        require(collateralPrice > 0, "Invalid collateral price");
        return (collateralAmount * uint256(collateralPrice)) / 1e8;
    }

    function getCurrentLoanValue(Loan memory loan) public view returns (uint256) {
        (, int256 btcPrice,,,) = btcPriceFeed.latestRoundData();
        require(btcPrice > 0, "Invalid BTC price");
        uint256 interest = calculateInterest(loan);
        return ((loan.principal + interest) * uint256(btcPrice)) / 1e8;
    }

    function calculateInterest(Loan memory loan) public view returns (uint256) {
        uint256 timeElapsed = block.timestamp - loan.startDate;
        return (loan.principal * loan.interestRate * timeElapsed) / (SECONDS_PER_YEAR * 100);
    }

    function getLoanDetails(address lender, address borrower) external view returns (
        uint256 borrowAmount,
        uint256 principal,
        uint256 interestRate,
        uint256 startDate,
        bool active,
        bytes memory btcAddress
    ) {
        Loan memory loan = loans[lender][borrower];
        return (
            loan.borrowAmount,
            loan.principal,
            loan.interestRate,
            loan.startDate,
            loan.active,
            loan.btcAddress
        );
    }
}