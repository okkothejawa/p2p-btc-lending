import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getFromLocalStorage } from "@/utils/localStorage";
import TransactionCard from "../TransactionCard";
import { setInLocalStorage } from "@/utils/localStorage";
import { useEffect } from "react";


interface Transaction {
  txid: string;
  status: string;
  borrowerAddress:string;
  createdAt: string;
}

type TransactionHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  latestBlockNumber: number;

};
const TransactionHistoryModal = ({
  isOpen,
  onClose,
  latestBlockNumber,
}: TransactionHistoryModalProps) => {
  let transactionHistory = getFromLocalStorage<Transaction[]>(
    "transactionHistory",
    []
  );
useEffect(() => {
    const checkPendingTransactions = async () => {
        if (!transactionHistory.length || !latestBlockNumber) return;
        
        const pendingTransactions = transactionHistory.filter(
            (tx) => tx.status === "pending"
        );
        
        if (!pendingTransactions.length) return;
        
        try {
            const updatedTransactions = [...transactionHistory];
            let hasUpdates = false;
            
            for (const tx of pendingTransactions) {
                try {
                    const txid = tx.txid;
                    const mempoolFetch = await fetch(`https://mempool.space/signet/api/tx/${txid}`);
                    const mempoolData = await mempoolFetch.json();
                    const mempoolStatus = mempoolData.status?.confirmed;
                    const mempoolBlockHeight = mempoolData.status?.block_height;

                    console.log(`Transaction ${txid} status:`, mempoolStatus);
                    console.log(`Transaction ${txid} block height:`, mempoolBlockHeight);
                    // TODO: Uncomment this when stopped testing
                    if (mempoolStatus) { // && latestBlockNumber >= mempoolBlockHeight) {
                        const txIndex = updatedTransactions.findIndex((t) => t.txid === txid);
                        if (txIndex !== -1) {
                            updatedTransactions[txIndex] = { ...tx, status: "confirmed" };
                            hasUpdates = true;
                        }
                    }
                } catch (error) {
                    console.error(`Error checking transaction ${tx.txid}:`, error);
                }
            }
            
            if (hasUpdates) {
                setInLocalStorage("transactionHistory", updatedTransactions);
                transactionHistory = updatedTransactions;
            }
        } catch (error) {
            console.error("Error checking pending transactions:", error);
        }
    };
    checkPendingTransactions();
}, [transactionHistory, latestBlockNumber]);

return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transaction History</DialogTitle>
        </DialogHeader>
        {transactionHistory.length > 0 ? (
          <div className="flex flex-col gap-4">
            {transactionHistory.map((transaction, index) => (
              <TransactionCard
                key={index}
                txid={transaction.txid}
                status={transaction.status}
                createdAt={transaction.createdAt}
                borrowerAddress= {transaction.borrowerAddress}
              />
            ))}
          </div>
        ) : (
          <p>No transaction history available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TransactionHistoryModal;
