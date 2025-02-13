interface UTXOType {
    txid: string;
    vout: number;
    value: number;
    addressType: string;
    address: string;
  }
  
  interface Window {
    unisat: {
      requestAccounts: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      getAddressUtxos: () => Promise<UTXOType[]>;
      createPsbt: (options: {
        inputs: Array<{
          txId: string;
          outputIndex: number;
          satoshis: number;
          addressType: string;
          address: string;
        }>;
        outputs: Array<{
          address: string;
          satoshis: number;
        }>;
        addresses: string[];
      }) => Promise<string>;
      signPsbt: (psbtBase64: string, options?: { sighashType?: number }) => Promise<string>;
    }
  }