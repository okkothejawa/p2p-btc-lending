sequenceDiagram
    participant Liquidator
    participant Contract
    
    Liquidator->>Contract: Trigger liquidation check
    Contract->>Contract: Verify collateral ratio is below threshold
    
    alt Collateral ratio below threshold
        Contract->>Contract: Calculate collateral distribution
        Contract->>Contract: Transfer liquidation portion to liquidator
        Contract->>Contract: Transfer remaining collateral to lender
        Contract->>Contract: Mark loan as inactive
        Contract->>Contract: Emit LoanLiquidated event
        
        Contract-->>Liquidator: Confirm liquidation successful
    else Collateral ratio above threshold
        Contract-->>Liquidator: Liquidation conditions not met
    end