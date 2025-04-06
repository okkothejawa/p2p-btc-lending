sequenceDiagram
    participant Borrower
    participant Frontend
    participant Contract
    participant PriceOracle
    
    Borrower->>Frontend: Create PSBT with dust input/output
    Frontend->>Borrower: Return PSBT
    Borrower->>Contract: Submit PSBT + interest rate
    Contract->>PriceOracle: Get asset price
    PriceOracle-->>Contract: Return price
    Contract->>Contract: Calculate required collateral
    Contract->>Borrower: Request collateral
    Borrower->>Contract: Send collateral
    Contract->>Contract: Store borrow request information
    Contract->>Contract: Emit BorrowRequestCreated event