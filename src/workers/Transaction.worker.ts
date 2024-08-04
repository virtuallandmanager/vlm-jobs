import { Job } from "bullmq";
import { getPendingAirdropTransactions, updateTransaction } from "../services/Transaction.service";
import { getBlockchainTransactionStatus } from "../services/Blockchain.service";
import { Accounting } from "../models/Accounting.model";
import { getGiveawayClaimById, updateClaimStatus } from "../services/Claim.service";
import { Giveaway } from "../models/Giveaway.model";

const worker = async (job: Job) => {
  await job.log("Job Started.");
  await job.log("Checking Pending Transactions");
  const pendingTransactions = await getPendingAirdropTransactions();
  const updatedTransactions = [];
  await job.log(`Found ${pendingTransactions.length} Pending Transactions`);
  for (const transaction of pendingTransactions) {
    await job.log(`Checking Transaction ${transaction.sk} - ${transaction.txType} - ${transaction.status} - ${transaction.blockchainTxIds.length} Blockchain Transactions`);
    if (transaction.blockchainTxIds.length === 0) return;

    const statuses = await Promise.all(
      transaction.blockchainTxIds.map(async (txId: string) => {
        await job.log(`Getting Transaction Status for ${txId}`);
        const status = await getBlockchainTransactionStatus(txId);
        await job.log(`Transaction Status for ${txId} is ${status}`);
        return status;
      })
    );

    await job.log(`Got Transaction Statuses: ${statuses}`);

    const transactionComplete = statuses.every((status: Accounting.TransactionStatus) => status === Accounting.TransactionStatus.COMPLETED),
      transactionPending = statuses.some((status: Accounting.TransactionStatus) => status === Accounting.TransactionStatus.PENDING),
      transactionFailed = statuses.some((status: Accounting.TransactionStatus) => status === Accounting.TransactionStatus.FAILED);

    await job.log(`Transaction Statuses: Complete: ${transactionComplete}, Pending: ${transactionPending}, Failed: ${transactionFailed}`);

    if (transactionPending) {
      await job.log("Transaction is still pending. Skipping this one.");
      continue;
    } else {
      await job.log("Transaction is not pending. Updating Transaction Status.");
    }

    await job.log(`Updating Transaction ${transaction.sk}`);

    if (transactionComplete && transaction.txType == Accounting.TransactionType.ITEM_GIVEAWAY && transaction.claimId) {
      await job.log(`Transaction ${transaction.sk} is Complete and is an Item Giveaway. Updating Claim Status.`);
      const claim = await getGiveawayClaimById(transaction.claimId);
      await job.log(`Got Claim ${claim.sk} with status ${claim.status}`);
      claim.status = Giveaway.ClaimStatus.COMPLETE;
      await updateClaimStatus(claim);
      await job.log(`Updated Claim ${claim.sk} with status ${claim.status}`);
    }

    if (transaction && transactionComplete) {
      transaction.status = Accounting.TransactionStatus.COMPLETED;
    } else if (transactionFailed) {
      transaction.status = Accounting.TransactionStatus.FAILED;
    }

    await updateTransaction(transaction);
    await job.log(`Updated Transaction ${transaction.sk} with status ${transaction.status}`);

    updatedTransactions.push(transaction);
    await job.log(`Updated ${updatedTransactions.length} Transactions`);
  }

  await job.log(`Finished Checking Pending Transactions`);

  const stillPending = pendingTransactions.filter((transaction) => transaction.status === Accounting.TransactionStatus.PENDING);

  if (updatedTransactions.length === 0 && pendingTransactions.length === 0) {
    return {
      success: true,
    };
  }

  await job.log(`Updated ${updatedTransactions.length} Transactions. ${pendingTransactions.length - updatedTransactions.length} Transactions are still pending.`);

  return {
    success: true,
    message: `Updated ${updatedTransactions.length} Transactions. ${pendingTransactions.length - updatedTransactions.length} Transactions are still pending.`,
    pendingTransactions: stillPending,
  };
};

export default worker;
