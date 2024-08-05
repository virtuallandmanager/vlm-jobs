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

export let job: Job;

const worker = async (newJob: Job) => {
  newJob.log("Claim Job Started.");
  job = newJob;
  if (job.data.type == "processPendingClaims") {
    const incompleteClaims = await getIncompleteClaims();
    incompleteClaims.length = 1;
    return await processPendingClaims(incompleteClaims);
  } else if (job.data.type === "rejuvenateClaims") {
    const insufficientCreditClaims = await getInsufficientCreditClaims();
    return await rejuvenateClaims(insufficientCreditClaims);
  }
};

const rejuvenateClaims = async (claims: Giveaway.Claim[]) => {
  if (!claims?.length) {
    // no incomplete claims found
    job.log("No Claims found to Rejuvenate");
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
  job.log(`Processing ${claims.length} Claims`);
  job.log(`Getting Gas Limits`);
  gasLimits = await getGasLimits("ETH:137");
  job.log(`Got Gas Limits: ${JSON.stringify(gasLimits)}`);
  if (!claims?.length) {
    // no incomplete claims found
    return {
      success: false,
    };
  } else {
    await Promise.all([
      claims.forEach(async (claim) => {
        if (!claim) return;
        if (claim.status === Giveaway.ClaimStatus.PENDING) {
          claim.status = Giveaway.ClaimStatus.IN_PROGRESS;
          await updateClaimStatus(claim);
          await job.log(`Updated Claim ${claim.sk} to In Progress`);
        }
      }),
    ]);
  }

  const transactionStates = await Promise.all(
    claims.map(
      async (claim: Giveaway.Claim): Promise<{ success: boolean; transactions: Array<ContractTransaction | any>; claim: Giveaway.Claim } | undefined> => {
        try {
          await job.log(`Processing Claim ${claim.sk}`);
          const giveaway = await getGiveawayById(claim.giveawayId);
          if (!giveaway?.items) return { success: false, transactions: [], claim };
          if (!giveaway?.allocatedCredits) {
            claim.status = Giveaway.ClaimStatus.INSUFFICIENT_CREDIT;
            await updateClaimStatus(claim);
            return { success: false, transactions: [], claim };
          }

          job.log(`Getting Items for Giveaway ${giveaway.sk}`);
          const itemIds: string[] = giveaway.items.map((item) => (typeof item == "string" ? item : String(item.sk)));
          const itemsForGiveaway = await getGiveawayItems(itemIds);
          if (!itemsForGiveaway) {
            job.log(`No Items found for Giveaway ${giveaway.sk}`);
            return { success: false, transactions: [], claim };
          }
          job.log(`Got Items for Giveaway ${giveaway.sk}`);
          job.log(`Finding Items with Shared Contract`);
          const groupedClaimItems = findItemsWithSharedContract(itemsForGiveaway);
          job.log(`Found Items with Shared Contract`);
          const transactionResponses = await sendWearables(groupedClaimItems, claim);
          job.log(`Sent Wearables for Claim ${claim.sk} - ${transactionResponses}`);
          job.log(`${transactionResponses}`);
          const successfulResponses: { success: boolean; transaction: ContractTransaction | any }[] = transactionResponses.filter((response) => response?.success && response?.transaction);
          await increaseClaimCountOfGiveaway(claim.giveawayId, successfulResponses.length);
          job.log(`Increased Claim Count for Giveaway ${claim.giveawayId}`);
          const transactions = successfulResponses.map((response) => response.transaction);
          job.log(`Finished processing Claim ${claim.sk}`);
          return { success: true, transactions, claim };
        } catch (error) {
          job.log(`Error processing Claim`);
          job.log(`${error}`);
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
      job.log(`Processing Transaction State ${JSON.stringify(transactionState)}`);
      if (!transactionState?.success || !transactionState?.transactions?.length) return;
      const { transactions, claim } = transactionState,
        blockchainTxIds = transactions.map((transaction) => transaction.hash).filter((hash) => hash);
      job.log(`Adding Blockchain Transaction Ids for Claim ${claim.sk}`);
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
