import { Job } from "bullmq";
import {
  findItemsWithSharedContract,
  getIncompleteClaims,
  getGiveawayById,
  getInsufficientCreditClaims,
  sendWearables,
  getGiveawayItems,
  getGasLimits,
  updateClaimStatus,
  increaseClaimCountOfGiveaway,
  getEventById,
} from "../services/Claim.service";
import { Giveaway } from "../models/Giveaway.model";
import { addBlockchainTransactionIds } from "../services/Transaction.service";
import { ContractReceipt, ContractTransaction } from "ethers";
import { Accounting } from "../models/Accounting.model";

export let gasLimits: { [key in Accounting.TxLimitsType]?: { unit: string; value: number } } = {};

const worker = async (job: Job) => {
  if (job.data.type == "processPendingClaims") {
    const incompleteClaims = await getIncompleteClaims();
    return await processPendingClaims(incompleteClaims);
  } else if (job.data.type === "rejuvenateClaims") {
    const insufficientCreditClaims = await getInsufficientCreditClaims();
    return await rejuvenateClaims(insufficientCreditClaims);
  }
};

const rejuvenateClaims = async (claims: Giveaway.Claim[]) => {
  if (!claims?.length) {
    // no incomplete claims found
    return {
      success: false,
    };
  } else {
    await Promise.all([
      claims.forEach(async (claim) => {
        const event = await getEventById(claim.eventId);
        if ((event?.eventStart && event?.eventStart > Date.now()) || (event?.eventEnd && event.eventEnd < Date.now())) return { success: false };
        const giveaway = await getGiveawayById(claim.giveawayId);
        if (!giveaway?.allocatedCredits) return { success: false };
        claim.status = Giveaway.ClaimStatus.PENDING;
        await updateClaimStatus(claim);
      }),
    ]);
  }
  return {
    success: true,
    message: `Rejuvenated ${claims.length} Claims`,
  };
};

const processPendingClaims = async (claims: Giveaway.Claim[]) => {
  gasLimits = await getGasLimits("ETH:137");

  if (!claims?.length) {
    // no incomplete claims found
    return {
      success: false,
    };
  } else {
    await Promise.all([
      claims.forEach(async (claim) => {
        if (claim.status === Giveaway.ClaimStatus.PENDING) {
          claim.status = Giveaway.ClaimStatus.IN_PROGRESS;
          await updateClaimStatus(claim);
        }
      }),
    ]);
  }

  const transactionStates = await Promise.all(
    claims.map(
      async (claim: Giveaway.Claim): Promise<{ success: boolean; transactions: Array<ContractTransaction>; claim: Giveaway.Claim } | undefined> => {
        try {
          const giveaway = await getGiveawayById(claim.giveawayId);
          if (!giveaway?.items) return { success: false, transactions: [], claim };
          if (!giveaway?.allocatedCredits) {
            claim.status = Giveaway.ClaimStatus.INSUFFICIENT_CREDIT;
            await updateClaimStatus(claim);
            return { success: false, transactions: [], claim };
          }
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
        blockchainTxIds = transactions.map((transaction) => transaction.hash).filter((hash) => hash);
      if (!blockchainTxIds.length) return transactionState;
      return await addBlockchainTransactionIds(claim.transactionId, blockchainTxIds);
    })
  );

  return {
    success: true,
    transactionStates,
    message: `Processed ${claims.length} Claims`,
    updatedTransactions,
  };
};

export default worker;
