interface UTXOType {
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

export interface SignPsbtOptions {
  autoFinalized: boolean;
  toSignInputs?: ToSignInput[];
}

export interface ToSignInput {
  index: number;
  address: string;
  sighashTypes?: number[];
  tapLeafHashToSign?: Buffer;
}

declare global {
  interface Window {
    unisat: {
      requestAccounts: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      getNetwork: () => Promise<string>;
      getBalance: () => Promise<{ total: number; confirmed: number; unconfirmed: number }>;
      switchNetwork: (network: string) => Promise<void>;
      signPsbt: (psbtBase64: string, options?: SignPsbtOptions) => Promise<string>;
      pushTx: (rawTxHex: string) => Promise<string>;
      getAddressUtxos: () => Promise<UTXOType[]>;
      createPsbt: (options: {
        inputs: {
          txId: string;
          outputIndex: number;
          satoshis: number;
          addressType: string;
          address: string;
        }[];
        outputs: {
          address: string;
          satoshis: number;
        }[];
        addresses: string[];
      }) => Promise<string>;
      pushPsbt: (psbtBase64: string) => Promise<string>;
      sendBitcoin: (address: string, amount: number, options?: { feeRate?: number }) => Promise<string>;
    };
  }
}

export {}; 