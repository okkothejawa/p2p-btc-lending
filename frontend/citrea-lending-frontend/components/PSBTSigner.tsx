"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wallet, ArrowRight, AlertCircle, DollarSign, Lock } from 'lucide-react';
import * as bitcoin from "bitcoinjs-lib";

const BorrowBtcIntent = () => {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [signedPsbt, setSignedPsbt] = useState('');
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isUnisatAvailable, setIsUnisatAvailable] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [collateralAmount, setCollateralAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [currentNetwork, setCurrentNetwork] = useState('');
  const [balance, setBalance] = useState(0);

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
      } catch (err) {
        console.error('Error checking UniSat:', err);
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
    } catch (err) {
      setError('Failed to switch network: ' + err.message);
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
    } catch (err) {
      setError('Failed to connect wallet: ' + err.message);
    }
  };

  const validateInputs = () => {
    if (!isWalletConnected) {
      setError('Please connect your UniSat wallet first');
      return false;
    }
    if (currentNetwork !== 'testnet') {
      setError('Please switch to testnet network');
      return false;
    }
    if (!borrowAmount || isNaN(Number(borrowAmount)) || Number(borrowAmount) <= 0) {
      setError('Please enter a valid borrow amount');
      return false;
    }
    if (!collateralAmount || isNaN(Number(collateralAmount)) || Number(collateralAmount) <= 0) {
      setError('Please enter a valid collateral amount');
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
      // Get UTXOs from UniSat wallet
      const utxos = await window.unisat.getUtxos();
      
      // Find a UTXO close to 330 sats
      const dustUtxo = utxos.find(utxo => utxo.value >= 330 && utxo.value <= 1000);
      
      if (!dustUtxo) {
        setError('No suitable dust UTXO found. Need a UTXO of ~330 sats.');
        return;
      }

      // Create new PSBT
      let psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      
      // Add the dust input
      psbt.addInput({
        hash: dustUtxo.txid,
        index: dustUtxo.vout,
        witnessUtxo: {
          script: Buffer.from(dustUtxo.scriptPk, 'hex'),
          value: dustUtxo.value
        }
      });

      // Add output for the borrow amount
      // This would typically go to the lender's address, but for this example we'll send back to our address
      psbt.addOutput({
        address: connectedAddress,
        value: Number(borrowAmount)
      });

      // Convert PSBT to base64
      const psbtBase64 = psbt.toBase64();

      // Sign with UniSat wallet
      const signedResult = await window.unisat.signPsbt(psbtBase64, {
        signingIndexes: [0],
        sighashTypes: [0x83], // SIGHASH_SINGLE|SIGHASH_ANYONECANPAY
      });
      
      setSignedPsbt(signedResult);
      setSuccess('Borrow intent created and signed successfully!');
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
            Create BTC Borrow Intent (testnet)
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

            {/* Collateral Amount Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Collateral Amount (sats)
              </label>
              <Input
                type="number"
                value={collateralAmount}
                onChange={(e) => setCollateralAmount(e.target.value)}
                placeholder="Enter collateral amount"
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
              disabled={!isWalletConnected || currentNetwork !== 'testnet'}
            >
              <Lock className="h-4 w-4" />
              Create Borrow Intent
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

export default BorrowBtcIntent;