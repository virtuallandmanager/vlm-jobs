import { Job } from "bullmq";
import {
  findItemsWithSharedContract,
  getIncompleteClaims,
  getGiveawayById,
  getGiveawayItemById,
  sendWearables,
  getGiveawayItems,
  getGasLimits,
  updateClaimStatus,
  increaseClaimCountOfGiveaway,
} from "../services/Claim.service";
import { Giveaway } from "../models/Giveaway.model";
import { addBlockchainTransactionIds } from "../services/Transaction.service";
import { ContractReceipt, ContractTransaction } from "ethers";
import { Accounting } from "../models/Accounting.model";

export let gasLimits: { [key in Accounting.TxLimitsType]?: { unit: string; value: number } } = {};

const worker = async (job: Job) => {
  gasLimits = await getGasLimits("ETH:137");
  let incompleteClaims = await getIncompleteClaims();
  console.log("incompleteClaims:", incompleteClaims);

  if (!incompleteClaims?.length) {
    // no incomplete claims found
    return {
      success: false,
    };
  } else {
    await Promise.all([
      incompleteClaims.forEach(async (claim) => {
        if (claim.status === Giveaway.ClaimStatus.PENDING) {
          claim.status = Giveaway.ClaimStatus.IN_PROGRESS;
          await updateClaimStatus(claim);
        }
      }),
    ]);
  }

  const transactionStates = await Promise.all(
    incompleteClaims.map(
      async (claim: Giveaway.Claim): Promise<{ success: boolean; transactions: Array<ContractTransaction>; claim: Giveaway.Claim } | undefined> => {
        try {
          const giveaway = await getGiveawayById(claim.giveawayId);
          if (!giveaway?.items) return { success: false, transactions: [], claim };
          const itemsForGiveaway = await getGiveawayItems(giveaway.items);
          if (!itemsForGiveaway) return { success: false, transactions: [], claim };
          const groupedClaimItems = findItemsWithSharedContract(itemsForGiveaway);
          const transactionResponses = await sendWearables(groupedClaimItems, claim);
          const successfulResponses: { success: boolean; transaction: ContractTransaction }[] = transactionResponses.filter((response) => response?.success && response?.transaction);
          await increaseClaimCountOfGiveaway(claim.giveawayId, successfulResponses.length);
          const transactions = successfulResponses.map((response) => response.transaction);
          return { success: true, transactions, claim };
        } catch (error) {
          console.error("Error processing claim", error);
          return {
            success: false,
            transactions: [],
            claim,
          };
        }
      }
    )
  );

  const updatedTransactions = await Promise.all(
    transactionStates.map(async (transactionState) => {
      if (!transactionState?.success || !transactionState?.transactions?.length) return;
      const { transactions, claim } = transactionState,
        blockchainTxIds = transactions.map((transaction) => transaction.hash);
      claim.status = Giveaway.ClaimStatus.IN_PROGRESS;
      return await addBlockchainTransactionIds(claim.transactionId, blockchainTxIds);
    })
  );

  return {
    success: true,
    transactionStates,
    message: `Processed ${incompleteClaims.length} Claims`,
    updatedTransactions,
  };
};

export default worker;
