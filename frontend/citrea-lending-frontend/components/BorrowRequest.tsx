"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Wallet,
  ArrowRight,
  AlertCircle,
  DollarSign,
  Lock,
} from "lucide-react";
import * as bitcoin from "bitcoinjs-lib";
import { useAccount, useWriteContract } from "wagmi";
import * as ecc from "tiny-secp256k1";
import ECPairFactory from "ecpair";
const ECPair = ECPairFactory(ecc);
import { request } from "sats-connect";

const BorrowRequest = () => {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [signedPsbt, setSignedPsbt] = useState("");
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isUnisatAvailable, setIsUnisatAvailable] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [currentNetwork, setCurrentNetwork] = useState("");
  const [balance, setBalance] = useState(0);

  // EVM wallet state from RainbowKit
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  // Define AddressPurpose enum that was missing
  const AddressPurpose = {
    Payment: "payment",
    Ordinals: "ordinals",
  };

  // Define RpcErrorCode enum that was missing
  const RpcErrorCode = {
    USER_REJECTION: 4001,
  };

  interface addressUTXO {
    txid: string;
    vout: number;
    value: number;
    status: {
      confirmed: boolean;
      block_height: number;
      block_hash: string;
      block_time: number;
    };
  }

  // Check if Sats Connect API is available
  useEffect(() => {
    const checkWallets = async () => {
      try {
        if (typeof window !== "undefined") {
          // Check if Sats Connect API is available
          if (typeof window.bitcoin !== "undefined") {
            setIsUnisatAvailable(true);
          }
        }
      } catch (error) {
        console.error("Error checking wallet availability:", error);
      }
    };
    
    checkWallets();
  }, []);

  const switchTotestnet = async () => {
    try {
      await window.unisat.switchNetwork("testnet");
      setCurrentNetwork("testnet");
      setSuccess("Switched to testnet successfully!");

      const balance = await window.unisat.getBalance();
      setBalance(balance.total);
    } catch (err) {
      setError("Failed to switch network: " + err.message);
    }
  };

  const connectWallet = async () => {
    try {
      setError(""); // Clear any previous errors
      
      const response = await request("wallet_connect", null);
      
      if (response.status === "success") {
        const paymentAddressItem = response.result.addresses.find(
          (address) => address.purpose === AddressPurpose.Payment
        );
        
        if (paymentAddressItem) {
          setConnectedAddress(paymentAddressItem.address);
          setIsWalletConnected(true);
          setSuccess("Xverse wallet connected successfully!");
          
          // Set network if available in the response
          if (response.result.network) {
            setCurrentNetwork(response.result.network);
          }
        } else {
          setError("No payment address found in wallet response");
        }
      } else {
        if (response.error && response.error.code === RpcErrorCode.USER_REJECTION) {
          setError("Wallet connection rejected by user");
        } else {
          setError(`Wallet connection failed: ${response.error ? response.error.message : 'Unknown error'}`);
        }
      }
    } catch (err) {
      console.error("Wallet connection error:", err);
      setError(`Failed to connect wallet: ${err.message || 'Unknown error'}`);
    }
  };

  const validateInputs = () => {
    if (!isWalletConnected) {
      setError("Please connect your wallet first");
      return false;
    }
    // if (currentNetwork !== "testnet") {
    //   setError("Please switch to testnet network");
    //   return false;
    // }
    if (
      !borrowAmount ||
      isNaN(Number(borrowAmount)) ||
      Number(borrowAmount) <= 0
    ) {
      setError("Please enter a valid borrow amount");
      return false;
    }
    if (
      !interestRate ||
      isNaN(Number(interestRate)) ||
      Number(interestRate) < 0
    ) {
      setError("Please enter a valid interest rate");
      return false;
    }
    return true;
  };

  const createAndSignIntent = async () => {
    if (!validateInputs()) return;

    try {
      bitcoin.initEccLib(ecc);
      // Get UTXOs from UniSat wallet
      const response = await fetch(
        `https://mempool.space/testnet4/api/address/${connectedAddress}/utxo`
      );
      const utxos: addressUTXO[] = await response.json();

      // Find a UTXO close to 330 sats
      let dustUtxo = utxos.find(
        (utxo) => utxo.value >= 1500 && utxo.value <= 3000
      );

      // If no suitable dust UTXO found, create one
      if (!dustUtxo) {
        // Find a larger UTXO to split
        const sourceUtxo = utxos.find((utxo) => utxo.value > 1500);
        if (!sourceUtxo) {
          setError(
            "No suitable UTXO found to create dust. Need a UTXO larger than 1500 sats."
          );
          return;
        }

        // Create simple transaction for splitting UTXO
        const splitTx = {
          inputs: [
            {
              txid: sourceUtxo.txid,
              vout: sourceUtxo.vout,
            },
          ],
          outputs: [
            {
              address: connectedAddress,
              value: 1500,
            },
            {
              address: connectedAddress,
              value: sourceUtxo.value - 1500 - 300, // 300 sats fee
            },
          ],
        };

        // // Sign and broadcast the split transaction
        // const splitTxId = await window.unisat.sendBitcoin(
        //   splitTx.outputs[0].address,
        //   splitTx.outputs[0].value,
        //   {
        //     feeRate: 1, // 1 sat/vB
        //   }
        // );

        const response = await request("sendTransfer", {
          recipients: [
            {
              address: splitTx.outputs[0].address,
              amount: splitTx.outputs[0].value,
            },
          ],
        });

        const splitTxId = response.status === "success" ? response.result.txid : null;

        if (!splitTxId) {
          setError("Failed to retrieve transaction ID from response");
          return;
        }
        console.log("b");


        // Wait for transaction to be included in mempool
        await new Promise((resolve) => setTimeout(resolve, 3000));
        console.log("b");


        // Refresh UTXOs
        const newResponse = await fetch(
          `https://mempool.space/testnet4/api/address/${connectedAddress}/utxo`
        );
        const newUtxos: addressUTXO[] = await newResponse.json();

        console.log("b");

        // Find our newly created dust UTXO
        dustUtxo = newUtxos.find(
          (utxo) => utxo.txid === splitTxId && utxo.value === 1500
        );

        if (!dustUtxo) {
          setError("Failed to find newly created dust UTXO in mempool");
          return;
        }
      }

      console.log("b");
      console.log("dustUtxo", dustUtxo);

      // Create new PSBT for the borrow intent
      let psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });

      // Add the dust input
      psbt.addInput({
        hash: dustUtxo.txid,
        index: dustUtxo.vout,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(
            connectedAddress,
            bitcoin.networks.testnet
          ),
          value: dustUtxo.value,
        },
        sighashType: 131,
      });

      // Add borrower's output - this ensures the borrower gets the exact amount they requested
      psbt.addOutput({
        address: connectedAddress,
        value: Number(borrowAmount),
      });

      // // Sign with UniSat wallet using SIGHASH_SINGLE | ANYONECANPAY
      // const signedResult = await window.unisat.signPsbt(psbt.toHex(), {
      //   autoFinalized: false,
      //   toSignInputs: [
      //     {
      //       index: 0,
      //       address: connectedAddress,
      //       sighashTypes: [131],
      //     },
      //   ],
      // });

      const psbtBase64 = psbt.toBase64();
      console.log("psbtBase64", psbtBase64);
      console.log("connectedAddress", connectedAddress);

      const signPsbtResponse = await request('signPsbt', {
        psbt: psbtBase64,
        signInputs: {
          connectedAddress: [0],
        },
      }); 

      if (signedPsbt.status === "success" && signedPsbt.result) {
        setSignedPsbt(signPsbtResponse.result.psbt);
        console.log("Signed PSBT:", signPsbtResponse.result.psbt);
      } else {
        setError("Failed to sign PSBT: " + (signedPsbt.error?.message || "Unknown error"));
      }

      // If EVM wallet is connected, submit the signed PSBT to the smart contract
      if (isEvmConnected) {
        try {
          // Convert BTC address to bytes by encoding it as UTF-8
          const btcAddressBytes = `0x${Buffer.from(connectedAddress).toString(
            "hex"
          )}`;
          // Convert hex (not base64) signed PSBT to bytes
          const psbtBytes = `0x${signedPsbt}`;
          console.log(psbtBytes);

          await writeContract({
            address: "0x9a676e781a523b5d0c0e43731313a708cb607508",
            abi: [
              {
                name: "requestBorrow",
                type: "function",
                stateMutability: "nonpayable",
                inputs: [
                  { name: "amount", type: "uint256" },
                  { name: "interestRate", type: "uint256" },
                  { name: "btcAddress", type: "bytes" },
                  { name: "signedPsbt", type: "bytes" },
                ],
                outputs: [],
              },
            ],
            functionName: "requestBorrow",
            args: [
              BigInt(borrowAmount),
              BigInt(Math.floor(parseFloat(interestRate) * 100)), // Convert to basis points
              btcAddressBytes,
              psbtBytes,
            ],
          });
          setSuccess("Borrow request submitted to smart contract!");
        } catch (err) {
          console.error("EVM transaction failed:", err);
          setError(
            "Failed to submit to smart contract. PSBT signed but not submitted."
          );
        }
      } else {
        setSuccess(
          "PSBT signed successfully! Please connect your EVM wallet to submit to smart contract."
        );
      }

      setError("");
    } catch (err) {
      setError(`Failed to create borrow intent: ${err.message}`);
      setSignedPsbt("");
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Create BTC Borrow Intent (testnet)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {false ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Bitcoin wallet extension not detected. Please install Xverse wallet.
                </AlertDescription>
              </Alert>
            ) : !isWalletConnected ? (
              <Button
                onClick={connectWallet}
                className="w-full flex items-center justify-center gap-2"
              >
                <Wallet className="h-4 w-4" />
                Connect to Xverse Wallet
              </Button>
            ) : (
              <>
                <Alert className="bg-green-50 text-green-800 border-green-200">
                  <AlertDescription>
                    Connected to: {connectedAddress.slice(0, 6)}...
                    {connectedAddress.slice(-4)}
                  </AlertDescription>
                </Alert>

                {currentNetwork !== "testnet" ? (
                  <Button
                    onClick={switchTotestnet}
                    className="w-full"
                    variant="outline"
                  >
                    Switch to testnet
                  </Button>
                ) : (
                  <Alert>
                    <AlertDescription>
                      Network: testnet | Balance: {balance} sats
                    </AlertDescription>
                  </Alert>
                )}

                {isEvmConnected ? (
                  <Alert className="bg-green-50 text-green-800 border-green-200">
                    <AlertDescription>
                      EVM Wallet Connected: {evmAddress?.slice(0, 6)}...
                      {evmAddress?.slice(-4)}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Please connect your EVM wallet to submit the borrow
                      request
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {/* Borrow Amount Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Borrow Amount (sats)
              </label>
              <Input
                type="number"
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                placeholder="Enter amount to borrow"
                className="font-mono"
              />
            </div>

            {/* Interest Rate Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Interest Rate (% APR)
              </label>
              <Input
                type="number"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="Enter interest rate"
                className="font-mono"
              />
            </div>

            {/* Create Intent Button */}
            <Button
              onClick={createAndSignIntent}
              className="w-full flex items-center justify-center gap-2"
              // disabled={
              //   // !isWalletConnected || currentNetwork !== "testnet" || isPending
              // }
            >
              <Lock className="h-4 w-4" />
              {isPending ? "Submitting to Contract..." : "Create Borrow Intent"}
            </Button>

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Success Display */}
            {success && (
              <Alert className="bg-green-50 text-green-800 border-green-200">
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {/* Signed Intent Output */}
            {signedPsbt && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">
                  Borrow Intent
                </label>
                <div className="relative">
                  <Input
                    value={signedPsbt}
                    readOnly
                    className="font-mono pr-10"
                  />
                  <Button
                    variant="ghost"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2"
                    onClick={() => {
                      navigator.clipboard.writeText(signedPsbt);
                      setSuccess("Copied to clipboard!");
                    }}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BorrowRequest;