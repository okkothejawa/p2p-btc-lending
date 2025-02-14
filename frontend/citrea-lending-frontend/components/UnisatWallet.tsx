'use client';

import React, { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Wallet, AlertCircle } from 'lucide-react';

function satsToBtc(sats: number) {
  return (sats / 100000000).toFixed(8);
}

const UnisatWallet = () => {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [isUnisatAvailable, setIsUnisatAvailable] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
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
            const balanceData = await window.unisat.getBalance();
            setBalance(balanceData.total);
          }
        }
      } catch (err) {
        console.error('Error checking UniSat:', err);
      }
    } else {
      setError(
        'UniSat wallet extension not detected. Please install it first.'
      );
    }
  };

  const switchTotestnet = async () => {
    try {
      await window.unisat.switchNetwork('testnet');
      setCurrentNetwork('testnet');
      setSuccess('Switched to testnet successfully!');

      const balanceData = await window.unisat.getBalance();
      setBalance(balanceData.total);
    } catch (err: any) {
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
        const balanceData = await window.unisat.getBalance();
        setBalance(balanceData.total);
      }

      setError('');
      setSuccess('Wallet connected successfully!');
    } catch (err: any) {
      setError('Failed to connect wallet: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* If UniSat is not available */}
      {!isUnisatAvailable ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            UniSat wallet extension not detected. Please install it first.
          </AlertDescription>
        </Alert>
      ) : !isWalletConnected ? (
        <Button
          variant="outline"
          size="lg"
          onClick={connectWallet}
          className="w-full flex items-center justify-center gap-2 rounded-xl font-semibold text-base px-4"
        >
          <Wallet className="h-4 w-4" />
          Connect UniSat Wallet
        </Button>
      ) : (
        <div className="gap-1 p-2 rounded-xl bg-zinc-950 font-semibold text-white drop-shadow-md hover:scale-[1.02] transition-transform">
          <div className="flex gap-4 items-center pl-1">
            <p> {satsToBtc(balance)} tBTC</p>
            <p className="bg-zinc-800 py-1.5 px-3 rounded-lg">
              {connectedAddress.slice(0, 5)}...
              {connectedAddress.slice(-5)}
            </p>
          </div>

          {currentNetwork !== 'testnet' && (
            <Button
              onClick={switchTotestnet}
              className="w-full"
              variant="outline"
            >
              Switch to testnet
            </Button>
          )}
        </div>
      )}

      {/* Error Display */}
    </div>
  );
};

export default UnisatWallet;
