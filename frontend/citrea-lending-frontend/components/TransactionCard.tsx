import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy } from "lucide-react";
import { useAccount, useWriteContract } from "wagmi";
import { withHexPrefix } from "@/utils/index";
import { getTransactionParams } from "@/lib/btc.js";

type TransactionCardProps = {
  txid: string;
  status: string;
  createdAt: string;
  borrowerAddress:string;
};
const TransactionCard = ({
  txid,
  status,
  createdAt,
  borrowerAddress
}: TransactionCardProps) => {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();
  const proveLending = async () => {
    try {
      let response = await fetch(
        `https://mempool.space/signet/api/tx/${txid}`
      );
      let data = await response.json();
      const blockHash = data.status?.block_hash;
      const blockHeight = data.status?.block_height;
      response = await fetch(
        `https://mempool.space/signet/api/block/${blockHash}/header`
      )
      const blockHeader = await response.text();
      const transactionParams = await getTransactionParams(txid, blockHeight);
      console.log("Transaction Params:", transactionParams);
      await writeContract({
        address: "0x5cbe734bc3b33370034871b1070b0820a02a1505",
        abi: [
          {
            name: "lend",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [{"name":"borrower","type":"address","internalType":"address"},{"name":"lendTp","type":"tuple","internalType":"struct P2PBTCLending.TransactionParams","components":[{"name":"version","type":"bytes4","internalType":"bytes4"},{"name":"vin","type":"bytes","internalType":"bytes"},{"name":"vout","type":"bytes","internalType":"bytes"},{"name":"locktime","type":"bytes4","internalType":"bytes4"},{"name":"intermediateNodes","type":"bytes","internalType":"bytes"},{"name":"blockHeight","type":"uint256","internalType":"uint256"},{"name":"index","type":"uint256","internalType":"uint256"}]},{"name":"blockHeader","type":"bytes","internalType":"bytes"}],
            outputs: [],
          },
        ],
        functionName: "lend",
        args: [withHexPrefix(borrowerAddress), transactionParams, withHexPrefix(blockHeader)],
      });
      
    } catch(e) {
      console.error("Error fetching transaction data:", e);
    }
  }
  return (
    <Card className="w-full h-full p-4 bg-white shadow-md rounded-lg">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Transaction ID: {txid.length > 16 ? 
              `${txid.substring(0, 8)}...${txid.substring(txid.length - 8)}` : 
              txid}
          </h2>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => {
              navigator.clipboard.writeText(txid);
              alert("Transaction ID copied to clipboard!");
            }}
            className="ml-2 p-1 h-8"
          >
           <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-gray-600">Status: {status}</p>
        <p className="text-gray-600">
          Created At: {new Date(createdAt).toLocaleString()}
        </p>
        {status =="confirmed" && (
          <Button variant="outline" className="mt-4" onClick= {() => proveLending()}>
            Prove Lend
          </Button>
        )}
      </div>
    </Card>
  );
};
export default TransactionCard;
