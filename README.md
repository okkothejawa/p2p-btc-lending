## Example Loan Flow


The following scenario is for borrowing stablecoins with BTC collateral where BTC price is fixed at 5 wei of USDC per BTC sats.  

1. In a new terminal tab, run anvil to launch a local EVM node.

```
anvil
```

2. In another terminal tab, run the following command to deploy the lending contract and mock stablecoin to be used as collateral token.

```
forge script ./script/DeployP2PBTCLending.s.sol --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast --rpc-url http://127.0.0.1:8545
```

3. Change directory to `stable-borrow-cli` and set the .env as where `LENDING_CONTRACT_ADDRESS` is the address of the deployed lending contract.

```
CITREA_RPC=http://127.0.0.1:8545
LENDING_CONTRACT_ADDRESS=<LENDING_CONTRACT_ADDRESS>
```

4. Run the following command from one terminal tab to start the application from the perspective of Alice who will be the lender.

```
docker compose --profile oracle up -d
docker compose exec bitcoind /scripts/create_wallets.sh
cargo run ./examples/configurations/alice.yml
```
5. In another terminal tab, run the following command to start the application from the perspective of Bob who will be the borrower.

```
cargo run ./examples/configurations/bob.yml
```

6. From Alice, run the following command to create a loan offer that has its expiration CETs set for testing. Do not forget to increment the `eventId`'s Unix timestamp to a future time.

```
offerloan <BOB_NODE_PUBLIC_KEY>@127.0.0.1:9001 ./examples/contracts/sample_loan_expiration.json
```

7. From Bob, run the following command to list loan offers, then locate the offered loan id and accept it.

```
listloanoffers
acceptloanoffer <OFFERED_LOAN_ID>
```

8. After accepting loan offer an escrow transaction is transmitted and to do that the lender and borrower should do some back and forth communication and processing on lender's side. So from Alice, press the enter key to forward the time from Alice's perspective, then run the block generation script to forward Bitcoin by producing blocks so transaction gets confirmed.

```
docker compose exec bitcoind /scripts/generate_blocks.sh
```

9. After these steps, go back to Bob's tab and run `listcontracts`. There should be a contract with the state of `Offered loan contract escrow confirmed`. Run `finishacceptloanoffer` on its id.

```
finishacceptloanoffer <contract-id>
```

10. From Alice, press the enter key for necessary message processing. Then do the same for Bob.

11. From Alice run `listcontracts`, there should be a `Signed contract` meaning that CETs are signed and exchanged between peers. Forward Bitcoin's time again.

```
listcontracts
docker compose exec bitcoind /scripts/generate_blocks.sh
```

12. From Alice, run `listcontracts`. You should see a `Confirmed contract` with maturity information, wait for its maturity and run `listcontracts` again. The loan will be settled with expiration and both parties will get their payouts.




