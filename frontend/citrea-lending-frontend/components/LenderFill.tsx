"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wallet, ArrowRight, AlertCircle, DollarSign, Lock } from 'lucide-react';
import * as bitcoin from "bitcoinjs-lib";
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
const ECPair = ECPairFactory(ecc);
// The type definitions are automatically included by TypeScript
// No need to import the .d.ts file explicitly

const LenderFill = () => {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isUnisatAvailable, setIsUnisatAvailable] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [currentNetwork, setCurrentNetwork] = useState('');
  const [balance, setBalance] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [borrowRequests, setBorrowRequests] = useState<any[]>([]);
  const [txIdState, setTxIdState] = useState<string>('');

  // EVM wallet state from RainbowKit
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();
  const { data: borrowRequest, error: readError } = useReadContract({
    address: '0x6469ECb9f2Bc066A4207f0fD25bfa90f501D65fB',
    abi: [{
      name: 'borrowRequests',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'borrower', type: 'address' }],
      outputs: [
        { name: 'amount', type: 'uint256' },
        { name: 'collateral', type: 'uint256' },
        { name: 'interestRate', type: 'uint256' },
        { name: 'btcAddress', type: 'bytes' },
        { name: 'signedPsbt', type: 'bytes' },
        { name: 'active', type: 'bool' }
      ]
    }],
    functionName: 'borrowRequests',
    args: [evmAddress || '0x0000000000000000000000000000000000000000'],
    enabled: isEvmConnected
  });

  useEffect(() => {
    if (borrowRequest && borrowRequest[5]) { // if active is true
      setBorrowRequests([{
        borrower: evmAddress,
        amount: borrowRequest[0],
        collateral: borrowRequest[1],
        interestRate: borrowRequest[2],
        btcAddress: borrowRequest[3],
        signedPsbt: borrowRequest[4],
        active: borrowRequest[5]
      }]);
    } else {
      setBorrowRequests([]);
    }
  }, [borrowRequest, evmAddress]);

  useEffect(() => {
    checkUnisatAvailability();
  }, []);

  const checkUnisatAvailability = async () => {
    if (typeof window.unisat !== 'undefined') {
      setIsUnisatAvailable(true);
      try {
        const network = await window.unisat.getNetwork();
        setCurrentNetwork(network);
        
        const accounts = await window.unisat.getAccounts();
        if (accounts && accounts.length > 0) {
          setIsWalletConnected(true);
          setConnectedAddress(accounts[0]);
          
          if (network === 'testnet') {
            const balance = await window.unisat.getBalance();
            setBalance(balance.total);
          }
        }
      } catch (error) {
        console.error('Error checking UniSat:', error);
        if (error instanceof Error) {
          setError(error.message);
        }
      }
    } else {
      setError('UniSat wallet extension not detected. Please install it first.');
    }
  };

  const switchTotestnet = async () => {
    try {
      await window.unisat.switchNetwork('testnet');
      setCurrentNetwork('testnet');
      setSuccess('Switched to testnet successfully!');
      
      const balance = await window.unisat.getBalance();
      setBalance(balance.total);
    } catch (error) {
      if (error instanceof Error) {
        setError('Failed to switch network: ' + error.message);
      }
    }
  };

  const connectWallet = async () => {
    try {
      const accounts = await window.unisat.requestAccounts();
      setIsWalletConnected(true);
      setConnectedAddress(accounts[0]);
      
      const network = await window.unisat.getNetwork();
      setCurrentNetwork(network);
      
      if (network !== 'testnet') {
        await switchTotestnet();
      } else {
        const balance = await window.unisat.getBalance();
        setBalance(balance.total);
      }
      
      setError('');
      setSuccess('Wallet connected successfully!');
    } catch (error) {
      if (error instanceof Error) {
        setError('Failed to connect wallet: ' + error.message);
      }
    }
  };

  async function postTransaction(rawTxHex: string) {
    let tempTxId = "";
    try {
      const response = await fetch("https://mempool.space/testnet4/api/tx", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: rawTxHex,
      });

      if (response.ok) {
        tempTxId = await response.text();
        setTxIdState(tempTxId);
        console.log("Transaction successfully posted, txid:", tempTxId);
      } else {
        console.error("Failed to post transaction:", response.statusText);
        throw new Error(`Failed to post transaction: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error posting transaction:", error);
      throw error;
    }
    return tempTxId;
  }

  const fillBorrowRequest = async (request: any) => {
    if (!isWalletConnected) {
      setError('Please connect your UniSat wallet first');
      return;
    }
    if (currentNetwork !== 'testnet') {
      setError('Please switch to testnet network');
      return;
    }

    try {
      bitcoin.initEccLib(ecc);
      // Get UTXOs from UniSat wallet
      const response = await fetch(`https://mempool.space/testnet4/api/address/${connectedAddress}/utxo`);
      const utxos = await response.json();
      
      // Find a UTXO that can cover the borrow amount
      const lenderUtxo = utxos.find((utxo: { value: number }) => utxo.value >= Number(request.amount));
      if (!lenderUtxo) {
        setError('No suitable UTXO found to cover the borrow amount');
        return;
      }

      try {
        // Parse the borrower's PSBT first
        const borrowerPsbtHex = request.signedPsbt.slice(2); // Remove '0x' prefix
        const borrowerPsbtBase64 = Buffer.from(borrowerPsbtHex, 'hex').toString('base64');
        console.log('Borrower PSBT Base64:', borrowerPsbtBase64);

        // Create a new PSBT
        const newPsbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });

        // Create a new PSBT from borrower's base64
        const originalPsbt = bitcoin.Psbt.fromBase64(borrowerPsbtBase64, { network: bitcoin.networks.testnet });
        console.log('Parsed borrower PSBT:', originalPsbt);

        // Copy outputs using txOutputs for correct format
        originalPsbt.txOutputs.forEach(output => {
            newPsbt.addOutput({
                address: bitcoin.address.fromOutputScript(output.script, bitcoin.networks.testnet),
                value: output.value
            });
        })

        console.log("newly created psbt", newPsbt);

        // Add lender's input
        newPsbt.addInput({
          hash: lenderUtxo.txid,
          index: lenderUtxo.vout,
          sequence: 0xfffffffd, // Enable RBF
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(connectedAddress, bitcoin.networks.testnet),
            value: lenderUtxo.value
          }
        });

        // Calculate fee (assuming ~200 sats/vbyte for faster confirmation)
        const feeRate = 200; // sats/vbyte
        const estimatedTxSize = 150; // typical 1-in-2-out transaction size in vbytes
        const fee = feeRate * estimatedTxSize;

        // Add lender's change output if there's change to return
        const changeAmount = lenderUtxo.value - Number(request.amount) - fee;
        if (changeAmount > 546) { // Only add change output if it's above dust limit
        newPsbt.addOutput({
            address: connectedAddress,
            value: changeAmount
        });
        }

        // Copy over the original inputs and outputs with proper formatting
        originalPsbt.data.inputs.forEach((input, index) => {
            const inputData = {
                hash: Buffer.from(originalPsbt.txInputs[index].hash),
                index: originalPsbt.txInputs[index].index,
                witnessUtxo: input.witnessUtxo,
                partialSig: input.partialSig,
                sequence: originalPsbt.txInputs[index].sequence,
            };

            if (input.sighashType !== undefined) {
                inputData.sighashType = input.sighashType;
            }
            newPsbt.addInput(inputData);
        });

        // Convert to base64 for UniSat wallet
        const psbtBase64 = newPsbt.toBase64();
        console.log('Combined PSBT Base64 for signing:', psbtBase64);

        // Sign with UniSat wallet
        const signedResult = await window.unisat.signPsbt(psbtBase64, {
            autoFinalized: true,
            sighashType: bitcoin.Transaction.SIGHASH_ALL  // Use SIGHASH_ALL for lender's input
          });
        console.log('Signed PSBT:', signedResult);

        // Finalize the PSBT
        const signedPsbt = bitcoin.Psbt.fromHex(signedResult);
        signedPsbt.finalizeInput(1);
        signedPsbt.finalizeInput(0);

        const rawTxHex = bitcoin.Psbt.fromHex(signedResult).extractTransaction().toHex();
        console.log('Raw transaction hex:', rawTxHex);

        // Broadcast the signed transaction
        const txid = await window.unisat.pushTx(rawTxHex);
        console.log('Transaction broadcasted:', txid);

        if (!txid) {
          throw new Error('Failed to broadcast transaction');
        }

        // Submit the filled request to the smart contract
        await writeContract({
          address: '0x6469ECb9f2Bc066A4207f0fD25bfa90f501D65fB',
          abi: [{
            name: 'lend',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'borrower', type: 'address' }
            ],
            outputs: []
          }],
          functionName: 'lend',
          args: [request.borrower]
        });

        setSuccess(`Borrow request filled successfully! Transaction ID: ${txid}`);
      } catch (error) {
        console.error('PSBT Error:', error);
        if (error instanceof Error) {
          setError(`PSBT Error: ${error.message}`);
        }
        return;
      }
    } catch (error) {
      console.error('Failed to fill borrow request:', error);
      if (error instanceof Error) {
        setError(`Failed to fill borrow request: ${error.message}`);
      }
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Fill Borrow Requests (testnet)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {!isUnisatAvailable ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  UniSat wallet extension not detected. Please install it first.
                </AlertDescription>
              </Alert>
            ) : !isWalletConnected ? (
              <Button 
                onClick={connectWallet}
                className="w-full flex items-center justify-center gap-2"
              >
                <Wallet className="h-4 w-4" />
                Connect UniSat Wallet
              </Button>
            ) : (
              <>
                <Alert className="bg-green-50 text-green-800 border-green-200">
                  <AlertDescription>
                    Connected to: {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
                  </AlertDescription>
                </Alert>
                
                {currentNetwork !== 'testnet' ? (
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
                      EVM Wallet Connected: {evmAddress?.slice(0, 6)}...{evmAddress?.slice(-4)}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Please connect your EVM wallet to view and fill borrow requests
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {/* Borrow Requests List */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Your Active Borrow Requests</h3>
              {borrowRequests.length === 0 ? (
                <Alert>
                  <AlertDescription>
                    No active borrow requests found for your address.
                  </AlertDescription>
                </Alert>
              ) : (
                borrowRequests.map((request, index) => (
                  request.active && (
                    <Card key={index} className="p-4">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Borrower:</span>
                          <span className="font-mono">{request.borrower.slice(0, 6)}...{request.borrower.slice(-4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Amount:</span>
                          <span className="font-mono">{request.amount.toString()} sats</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Interest Rate:</span>
                          <span className="font-mono">{(Number(request.interestRate) / 100).toString()}% APR</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Collateral:</span>
                          <span className="font-mono">{request.collateral.toString()} wei</span>
                        </div>
                        <Button
                          onClick={() => fillBorrowRequest(request)}
                          className="w-full mt-2"
                          disabled={isPending}
                        >
                          {isPending ? 'Filling Request...' : 'Fill Request'}
                        </Button>
                      </div>
                    </Card>
                  )
                ))
              )}
            </div>

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
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LenderFill; 