sequenceDiagram
    participant Lender
    participant Frontend
    participant Contract
    participant Bitcoin
    
    Lender->>Frontend: Select active borrow request
    Frontend->>Contract: Request borrow details
    Contract-->>Frontend: Return borrow request details
    Frontend-->>Lender: Display borrow request details
    Lender->>Lender: Add input and change output to borrower's PSBT
    Lender->>Bitcoin: Broadcast final PSBT
    Bitcoin-->>Lender: Confirm transaction broadcast
    Note over Lender,Bitcoin: Wait for transaction inclusion
    Bitcoin-->>Lender: Transaction confirmed
    Lender->>Contract: Submit transaction
    Contract->>Contract: Verify loan transaction
    Contract->>Contract: Remove borrow request from active requests
    Contract->>Contract: Store loan details
    Contract->>Contract: Emit LoanCreated event