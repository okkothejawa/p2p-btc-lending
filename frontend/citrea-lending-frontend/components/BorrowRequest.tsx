"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wallet, ArrowRight, AlertCircle, DollarSign, Lock } from 'lucide-react';
import * as bitcoin from "bitcoinjs-lib";
import { useAccount, useWriteContract } from 'wagmi';
import * as ecc from 'tiny-secp256k1';
import { withHexPrefix } from "@/utils/index";

const BorrowRequest = () => {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [signedPsbt, setSignedPsbt] = useState('');
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isUnisatAvailable, setIsUnisatAvailable] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [currentNetwork, setCurrentNetwork] = useState('');
  const [balance, setBalance] = useState(0);

  // EVM wallet state from RainbowKit
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

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

  useEffect(() => {
    checkUnisatAvailability();
  }, []);

  const checkUnisatAvailability = async () => {
    if (typeof window.unisat !== 'undefined') {
      setIsUnisatAvailable(true);
      try {
        const networkData = await window.unisat.getChain();
        const network = networkData.enum;
        setCurrentNetwork(network);
        
        const accounts = await window.unisat.getAccounts();
        if (accounts && accounts.length > 0) {
          setIsWalletConnected(true);
          setConnectedAddress(accounts[0]);
          
          if (network === 'BITCOIN_SIGNET') {
            const balance = await window.unisat.getBalance();
            setBalance(balance.total);
          }
        }
      } catch (err) {
        console.error('Error checking UniSat:', err);
      }
    } else {
      setError('UniSat wallet extension not detected. Please install it first.');
    }
  };

  const switchTotestnet = async () => {
    try {
      await window.unisat.switchChain('BITCOIN_SIGNET');
      setCurrentNetwork('BITCOIN_SIGNET');
      setSuccess('Switched to signet successfully!');
      
      const balance = await window.unisat.getBalance();
      setBalance(balance.total);
    } catch (err) {
      setError('Failed to switch network: ' + err.message);
    }
  };

  const connectWallet = async () => {
    try {
      const accounts = await window.unisat.requestAccounts();
      setIsWalletConnected(true);
      setConnectedAddress(accounts[0]);
      
      const networkData = await window.unisat.getChain();
      const network = networkData.enum;
      setCurrentNetwork(network);
      
      if (network !== 'BITCOIN_SIGNET') {
        await switchTotestnet();
      } else {
        const balance = await window.unisat.getBalance();
        setBalance(balance.total);
      }
      
      setError('');
      setSuccess('Wallet connected successfully!');
    } catch (err) {
      setError('Failed to connect wallet: ' + err.message);
    }
  };

  const validateInputs = () => {
    if (!isWalletConnected) {
      setError('Please connect your UniSat wallet first');
      return false;
    }
    if (currentNetwork !== 'BITCOIN_SIGNET') {
      setError('Please switch to signet network');
      return false;
    }
    if (!borrowAmount || isNaN(Number(borrowAmount)) || Number(borrowAmount) <= 0) {
      setError('Please enter a valid borrow amount');
      return false;
    }
    if (!interestRate || isNaN(Number(interestRate)) || Number(interestRate) < 0) {
      setError('Please enter a valid interest rate');
      return false;
    }
    return true;
  };

  const createAndSignIntent = async () => {
    if (!validateInputs()) return;
    
    try {
      bitcoin.initEccLib(ecc);
      // Get UTXOs from UniSat wallet
      const response = await fetch(`https://mempool.space/signet/api/address/${connectedAddress}/utxo`);
      const utxos: addressUTXO[] = await response.json();
      
      // Find a UTXO close to 330 sats
      let dustUtxo = utxos.find(utxo => utxo.value >= 330 && utxo.value <= 1000);
      
      // If no suitable dust UTXO found, create one
      if (!dustUtxo) {
        // Find a larger UTXO to split
        const sourceUtxo = utxos.find(utxo => utxo.value > 1000);
        if (!sourceUtxo) {
          setError('No suitable UTXO found to create dust. Need a UTXO larger than 1000 sats.');
          return;
        }
  
        // Create simple transaction for splitting UTXO
        const splitTx = {
          inputs: [{
            txid: sourceUtxo.txid,
            vout: sourceUtxo.vout
          }],
          outputs: [{
            address: connectedAddress,
            value: 330
          }, {
            address: connectedAddress,
            value: sourceUtxo.value - 330 - 300 // 300 sats fee
          }]
        };
  
        // Sign and broadcast the split transaction
        const splitTxId = await window.unisat.sendBitcoin(
          splitTx.outputs[0].address, 
          splitTx.outputs[0].value,
          {
            feeRate: 1 // 1 sat/vB
          }
        );
        
        // Wait for transaction to be included in mempool
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Refresh UTXOs
        const newResponse = await fetch(`https://mempool.space/signet/api/address/${connectedAddress}/utxo`);
        const newUtxos: addressUTXO[] = await newResponse.json();
        
        // Find our newly created dust UTXO
        dustUtxo = newUtxos.find(utxo => 
          utxo.txid === splitTxId && 
          utxo.value === 330
        );
        
        if (!dustUtxo) {
          setError('Failed to find newly created dust UTXO in mempool');
          return;
        }
      }
  
      // Create new PSBT for the borrow intent
      let psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      
      // Add the dust input
      psbt.addInput({
        hash: dustUtxo.txid,
        index: dustUtxo.vout,
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(connectedAddress, bitcoin.networks.testnet),
          value: dustUtxo.value
        },
        sighashType: 131
      });

      // Add borrower's output - this ensures the borrower gets the exact amount they requested
      psbt.addOutput({
        address: connectedAddress,
        value: Number(borrowAmount)
      });
      
      // Sign with UniSat wallet using SIGHASH_SINGLE | ANYONECANPAY
      const signedResult = await window.unisat.signPsbt(psbt.toHex(), {
        autoFinalized: false,
        toSignInputs:[
          {
            index: 0,
            address: connectedAddress,
            sighashTypes: [131]
          },
        ]
      });
  
      setSignedPsbt(signedResult);

      // If EVM wallet is connected, submit the signed PSBT to the smart contract
      if (isEvmConnected) {
        try {
          // Convert BTC address to bytes by encoding it as UTF-8
          const btcAddressBytes = bitcoin.address.fromBech32(connectedAddress).data.toString('hex');
          // Convert hex (not base64) signed PSBT to bytes
          const psbtBytes = `0x${signedResult}`;
          console.log(psbtBytes);
          console.log(btcAddressBytes);

          await writeContract({
            address: '0x5cbe734bc3b33370034871b1070b0820a02a1505',
            abi: [{
              name: 'requestBorrow',
              type: 'function',
              stateMutability: 'nonpayable',
              inputs: [
                { name: 'amount', type: 'uint256' },
                { name: 'interestRate', type: 'uint256' },
                { name: 'btcAddress', type: 'bytes' },
                { name: 'signedPsbt', type: 'bytes' }
              ],
              outputs: []
            }],
            functionName: 'requestBorrow',
            args: [
              BigInt(borrowAmount),
              BigInt(Math.floor(parseFloat(interestRate) * 100)), // Convert to basis points
              withHexPrefix(btcAddressBytes),
              withHexPrefix(psbtBytes)
            ]
          });
          setSuccess('Borrow request submitted to smart contract!');
        } catch (err) {
          console.error('EVM transaction failed:', err);
          setError('Failed to submit to smart contract. PSBT signed but not submitted.');
        }
      } else {
        setSuccess('PSBT signed successfully! Please connect your EVM wallet to submit to smart contract.');
      }

      setError('');
    } catch (err) {
      setError(`Failed to create borrow intent: ${err.message}`);
      setSignedPsbt('');
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Create BTC Borrow Intent (signet)
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
                
                {currentNetwork !== 'BITCOIN_SIGNET' ? (
                  <Button 
                    onClick={switchTotestnet}
                    className="w-full"
                    variant="outline"
                  >
                    Switch to signet
                  </Button>
                ) : (
                  <Alert>
                    <AlertDescription>
                      Network: signet | Balance: {balance} sats
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
                      Please connect your EVM wallet to submit the borrow request
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
              disabled={!isWalletConnected || currentNetwork !== 'BITCOIN_SIGNET' || isPending}
            >
              <Lock className="h-4 w-4" />
              {isPending ? 'Submitting to Contract...' : 'Create Borrow Intent'}
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
                      setSuccess('Copied to clipboard!');
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