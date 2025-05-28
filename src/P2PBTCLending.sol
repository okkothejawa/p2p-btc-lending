// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "./IBitcoinLightClient.sol";
import {console2} from "forge-std/Test.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "bitcoin-spv/solidity/contracts/ValidateSPV.sol";
import "bitcoin-spv/solidity/contracts/BTCUtils.sol";
import "./interfaces/AggregatorV3Interface.sol";

// TODO: Rename regular named functions to end with BTC to avoid confusion with stablecoin lending functions
contract P2PBTCLending is ReentrancyGuard {
    using BTCUtils for bytes;

    IBitcoinLightClient public lightClient = IBitcoinLightClient(address(0x3100000000000000000000000000000000000001));
    IERC20 public immutable stableToken;
    AggregatorV3Interface public immutable collateralPriceFeed;
    AggregatorV3Interface public immutable btcPriceFeed;

    bool public testMode = true;

    uint256 public constant COLLATERAL_RATIO = 150; // 150% collateral required
    uint256 public constant LIQUIDATION_THRESHOLD = 125; // 125% liquidation threshold
    uint256 public constant LIQUIDATION_BONUS = 5; // 5% bonus for liquidators
    uint256 public constant SECONDS_PER_YEAR = 31536000;

    struct BorrowRequest {
        uint256 amount;
        uint256 collateral;
        uint256 interestRate;
        bytes btcAddress;
        bytes signedPsbt;
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

    struct TransactionParams {
        bytes4 version;
        bytes vin;
        bytes vout;
        bytes4 locktime;
        bytes intermediateNodes;
        uint256 blockHeight;
        uint256 index;
    }

    struct StableLoan {
        uint256 collateralAmount;
        uint256 stableLoanAmount;
        uint128 borrowerPreimage;
    }

    mapping(address => BorrowRequest) public borrowRequests;
    mapping(address => mapping(address => Loan)) public loans;
    mapping(bytes32 => StableLoan) public stableLoans;

    event BorrowRequestCreated(address indexed borrower, uint256 amount, uint256 interestRate, bytes btcAddress);
    event BorrowRequestCancelled(address indexed borrower);
    event LoanCreated(address indexed borrower, address indexed lender, uint256 amount, uint256 interestRate);
    event LoanRepaid(address indexed borrower, address indexed lender, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event LoanLiquidated(address indexed borrower, address indexed liquidator, uint256 amount);
    event StableLoanCreated(bytes32 indexed borrowerHash, uint256 collateralAmount, uint256 stableLoanAmount);
    event StableClaimed(bytes32 indexed borrowerHash, uint256 stableLoanAmount, uint128 borrowerPreimage, address indexed borrower);

    constructor(
        address _stableToken,
        address _collateralPriceFeed,
        address _btcPriceFeed
    ) {
        stableToken = IERC20(_stableToken);
        collateralPriceFeed = AggregatorV3Interface(_collateralPriceFeed);
        btcPriceFeed = AggregatorV3Interface(_btcPriceFeed);
    }

    function requestBorrow(uint256 amount, uint256 interestRate, bytes memory btcAddress, bytes memory signedPsbt) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(btcAddress.length > 0, "Invalid BTC address");
        require(!borrowRequests[msg.sender].active, "Active borrow request exists");
        
        uint256 collateralAmount = getStableCollateralAmount(amount);
        require(stableToken.transferFrom(msg.sender, address(this), collateralAmount), "Collateral transfer failed");

        borrowRequests[msg.sender] = BorrowRequest({
            amount: amount,
            collateral: collateralAmount,
            interestRate: interestRate,
            btcAddress: btcAddress,
            signedPsbt: signedPsbt,
            active: true
        });

        emit BorrowRequestCreated(msg.sender, amount, interestRate, btcAddress);
    }

    function cancelBorrowRequest() external nonReentrant {
        BorrowRequest memory request = borrowRequests[msg.sender];
        require(request.active, "No active borrow request");
        require(stableToken.transfer(msg.sender, request.collateral), "Collateral return failed");
        delete borrowRequests[msg.sender];
        emit BorrowRequestCancelled(msg.sender);
    }

    function lend(address borrower, TransactionParams calldata lendTp, bytes memory blockHeader) external nonReentrant {
        BorrowRequest memory request = borrowRequests[borrower];
        require(request.active, "No active borrow request");
        require(!loans[msg.sender][borrower].active, "Loan already exists");

        require(BTCUtils.validateVin(lendTp.vin), "Vin is not properly formatted");
        require(BTCUtils.validateVout(lendTp.vout), "Vout is not properly formatted");

        if (!testMode) {
            bytes32 txId = ValidateSPV.calculateTxId(lendTp.version, lendTp.vin, lendTp.vout, lendTp.locktime);
            require(lightClient.verifyInclusionByTxId(lendTp.blockHeight, txId, blockHeader, lendTp.intermediateNodes, lendTp.index), "Transaction is not in block");
        }

        bytes memory output0 = lendTp.vout.extractOutputAtIndex(0);
        uint64 amount = output0.extractValue();
        require(amount == request.amount, "Invalid loan amount");
        bytes memory addr = output0.extractHash();
        require(keccak256(addr) == keccak256(request.btcAddress), "Invalid BTC address");

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

        uint256 collateralAmount = getStableCollateralAmount(loan.borrowAmount);
        require(stableToken.transfer(msg.sender, collateralAmount), "Collateral return failed");

        loan.active = false;
        emit LoanRepaid(msg.sender, lender, totalRepayment);
    }

    function liquidate(address borrower, address lender) external nonReentrant {
        Loan storage loan = loans[lender][borrower];
        require(loan.active, "No active loan");
        
        uint256 collateralAmount = getStableCollateralAmount(loan.borrowAmount);
        uint256 currentCollateralValue = getCurrentCollateralValue(collateralAmount);
        uint256 currentLoanValue = getCurrentLoanValue(loan);
        
        require(currentCollateralValue * 100 < currentLoanValue * LIQUIDATION_THRESHOLD, "Cannot liquidate");
        
        uint256 liquidatorReward = (collateralAmount * LIQUIDATION_BONUS) / 100;
        uint256 remainingCollateral = collateralAmount - liquidatorReward;
        
        require(stableToken.transfer(msg.sender, liquidatorReward), "Liquidator reward transfer failed");
        require(stableToken.transfer(lender, remainingCollateral), "Remaining collateral transfer failed");
        
        loan.active = false;
        emit LoanLiquidated(borrower, msg.sender, collateralAmount);
    }

    function lendStable(bytes32 borrowerHash, uint256 btcCollateralAmount) external nonReentrant {
        require(btcCollateralAmount > 0, " BTC Collateral amount must be greater than 0");
        StableLoan memory stableLoan = stableLoans[borrowerHash];
        require(stableLoan.collateralAmount == 0, "Loan already exists for this borrower");
        uint256 stableLoanAmount = getStableLoanAmount(btcCollateralAmount);
        require(stableToken.transferFrom(msg.sender, address(this), stableLoanAmount), "Stable token transfer failed");
        stableLoan.collateralAmount = btcCollateralAmount;
        stableLoan.stableLoanAmount = stableLoanAmount;
        stableLoans[borrowerHash] = stableLoan;
        emit StableLoanCreated(borrowerHash, btcCollateralAmount, stableLoanAmount);
    }

    function claimStable(uint128 borrowerPreimage) external nonReentrant {
        bytes32 borrowerHash = sha256(abi.encodePacked(borrowerPreimage));
        StableLoan memory stableLoan = stableLoans[borrowerHash];
        require(stableLoan.collateralAmount > 0, "No stable loan exists for this borrower");
        require(stableToken.transfer(msg.sender, stableLoan.stableLoanAmount), "Stable token transfer failed");
        stableLoans[borrowerHash].borrowerPreimage = borrowerPreimage;
        emit StableClaimed(borrowerHash, stableLoan.stableLoanAmount, borrowerPreimage, msg.sender);
    }

    function setTestMode(bool _testMode) external {
        testMode = _testMode;
    }

    function getStableCollateralAmount(uint256 amount) public view returns (uint256) {
        (, int256 btcPrice,,,) = btcPriceFeed.latestRoundData();
        (, int256 collateralPrice,,,) = collateralPriceFeed.latestRoundData();
        
        require(btcPrice > 0 && collateralPrice > 0, "Invalid price data");
        
        // Calculate required collateral with 150% overcollateralization
        uint256 requiredCollateral = (amount * uint256(btcPrice) * COLLATERAL_RATIO) / (uint256(collateralPrice) * 100);
        return requiredCollateral;
    }

    function getStableLoanAmount(uint256 btcCollateralAmount) public view returns (uint256) {
        (, int256 btcPrice,,,) = btcPriceFeed.latestRoundData();
        (, int256 collateralPrice,,,) = collateralPriceFeed.latestRoundData();
        
        require(btcPrice > 0 && collateralPrice > 0, "Invalid price data");

        // Calculate stable loan amount based on collateral
        uint256 stableLoanAmount = (btcCollateralAmount * uint256(collateralPrice) * 100) / (uint256(btcPrice) * COLLATERAL_RATIO);
        return stableLoanAmount;
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