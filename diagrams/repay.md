sequenceDiagram
    participant Borrower
    participant Frontend
    participant Contract
    participant Bitcoin
    
    Borrower->>Frontend: Initiate repayment process
    Frontend->>Contract: Request loan details
    Contract-->>Frontend: Return loan details
    Frontend-->>Borrower: Display repayment instructions
    
    Borrower->>Bitcoin: Send BTC payment to lender address
    Bitcoin-->>Contract: Transaction broadcast
    
    Note over Bitcoin,Contract: Wait for transaction confirmation
    
    Bitcoin-->>Contract: Transaction confirmed
    Contract->>Contract: Verify BTC payment
    
    Contract->>Contract: Validate payment amount and recipient
    Contract->>Contract: Release collateral to borrower
    Contract->>Contract: Mark loan as inactive
    Contract->>Contract: Emit LoanRepaid event
    
    Contract-->>Frontend: Confirm loan repayment
    Frontend-->>Borrower: Display repayment confirmation