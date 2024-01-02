import { Job } from "bullmq";
import { findItemsWithSharedContract, getIncompleteClaims, getGiveawayById, getGiveawayItemById, sendWearables, getGiveawayItems } from "../services/Claim.service";
import { Giveaway } from "../models/Giveaway.model";

const worker = async (job: Job) => {
  let incompleteClaims = await getIncompleteClaims();
  console.log("incompleteClaims:", incompleteClaims);

  if (!incompleteClaims?.length) {
    // no incomplete claims found
    return {
      success: false,
    };
  }

  const transactionStates = await Promise.all(
    incompleteClaims.map(async (claim: Giveaway.Claim) => {
      const giveaway = await getGiveawayById(claim.giveawayId);
      if (!giveaway?.items) return;
      const itemsForGiveaway = await getGiveawayItems(giveaway.items);
      if (!itemsForGiveaway) return;
      const groupedClaimItems = findItemsWithSharedContract(itemsForGiveaway);
      console.log("groupedClaimItems:", groupedClaimItems);
      const transactionResponses = await sendWearables(groupedClaimItems, claim);
      const successfulReponses = transactionResponses.filter((response) => response?.success);
      const transactions = successfulReponses.map((response) => response);
      return { transactions, claim };
    })
  );

  const updatedTransactions = await Promise.all(
    transactionStates.map(async (transactionState) => {
      if (!transactionState?.transactions?.length) return;
      const { transactions, claim } = transactionState;
      // return await addBlockchainTransactionIds(claim.transactionId, transactions);
    })
  );

  return {
    success: true,
    transactionStates,
    message: `Processed ${incompleteClaims.length} Claims`,
  };
};

export default worker;
