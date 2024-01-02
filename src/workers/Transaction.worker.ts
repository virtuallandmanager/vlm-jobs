import { Job } from "bullmq";
import { getPendingAirdropTransactions, updateTransaction } from "../services/Transaction.service";
import { getBlockchainTransactionStatus } from "../services/Blockchain.service";
import { Accounting } from "../models/Accounting.model";

const worker = async (job: Job) => {
  const pendingTransactions = await getPendingAirdropTransactions();
  const updatedTransactions = [];
  for (const transaction of pendingTransactions) {
    if (transaction.blockchainTxIds.length === 0) return;

    const statuses = await Promise.all(
      transaction.blockchainTxIds.map(async (txId: string) => {
        return await getBlockchainTransactionStatus(txId);
      })
    );

    const transactionComplete = statuses.every((status: Accounting.TransactionStatus) => status === Accounting.TransactionStatus.COMPLETED),
      transactionPending = statuses.some((status: Accounting.TransactionStatus) => status === Accounting.TransactionStatus.PENDING),
      transactionFailed = statuses.some((status: Accounting.TransactionStatus) => status === Accounting.TransactionStatus.FAILED);

    if (transactionPending) {
      continue;
    }

    if (transactionComplete) {
      transaction.status = Accounting.TransactionStatus.COMPLETED;
    } else if (transactionFailed) {
      transaction.status = Accounting.TransactionStatus.FAILED;
    }

    await updateTransaction(transaction);

    updatedTransactions.push(transaction);
  }

  const stillPending = pendingTransactions.filter((transaction) => transaction.status === Accounting.TransactionStatus.PENDING);

  if (updatedTransactions.length === 0 && pendingTransactions.length === 0) {
    return {
      success: true,
    };
  }

  return {
    success: true,
    message: `Updated ${updatedTransactions.length} Transactions. ${pendingTransactions.length - updatedTransactions.length} Transactions are still pending.`,
    pendingTransactions: stillPending,
  };
};

export default worker;
