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
  checkIfGasLimited,
  ethersWallet,
  NonceManager,
  updateUserGiveawayTransactionList,
  decreaseCreditAllocationOfGiveaway,
  getCreditAllocationByGiveawayId,
} from "../services/Claim.service";
import { Giveaway } from "../models/Giveaway.model";
import { addBlockchainTransactionIds } from "../services/Transaction.service";
import { ContractTransaction } from "ethers";
import { Accounting } from "../models/Accounting.model";

export let gasLimits: { [key in Accounting.TxLimitsType]?: { unit: string; value: number } } = {};

export let job: Job;

const worker = async (newJob: Job) => {
  newJob.log("Claim Job Started.");
  job = newJob;
  if (job.data.type == "processPendingClaims") {
    const incompleteClaims = await getIncompleteClaims();
    if (incompleteClaims.length > 30) {
      incompleteClaims.length = 30;
    }
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
      claims.map(async (claim) => {
        const giveaway = await getGiveawayById(claim.giveawayId);
        if (!giveaway?.allocatedCredits) return { success: false, message: `${giveaway.name} giveaway is out of allocated credits` };
        claim.status = Giveaway.ClaimStatus.PENDING;
        await updateClaimStatus(claim);
        return claim;
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
  const response = await checkIfGasLimited();
  if (response.gasLimited) {
    job.log("Gas price too high. Skipping Claims");
    return {
      success: false,
      error: true,
      message: `Gas price too high. Currently ${response.gasPrice} gwei. Skipping Claims.`,
    };
  }
  if (!claims?.length) {
    // no incomplete claims found
    return {
      success: false,
    };
  } else {
    for (const claim of claims) {
      if (claim?.status === Giveaway.ClaimStatus.PENDING) {
        claim.status = Giveaway.ClaimStatus.IN_PROGRESS;
        await updateClaimStatus(claim);
        await job.log(`Updated Claim ${claim.sk} to In Progress`);
      }
    }
  }

  const initialNonce = await ethersWallet.getTransactionCount("latest");
  const nonceManager = new NonceManager(initialNonce);
  const transactionStates = [];

  for (const claim of claims) {
    if (!claim?.sk) {
      continue;
    }
    try {
      await job.log(`Processing Claim ${claim.sk}`);
      const giveaway = await getGiveawayById(claim.giveawayId);
      if (!giveaway?.items) {
        transactionStates.push({ success: false, transactions: [], claim });
        continue;
      }
      if (!giveaway?.allocatedCredits) {
        claim.status = Giveaway.ClaimStatus.INSUFFICIENT_CREDIT;
        await updateClaimStatus(claim);
        transactionStates.push({ success: false, transactions: [], claim });
        continue;
      }

      job.log(`Getting Items for Giveaway ${giveaway.sk}`);
      const itemIds: string[] = giveaway.items.map((item) => (typeof item == "string" ? item : String(item.sk)));
      const itemsForGiveaway = await getGiveawayItems(itemIds);
      if (!itemsForGiveaway) {
        job.log(`No Items found for Giveaway ${giveaway.sk}`);
        transactionStates.push({ success: false, transactions: [], claim });
        continue;
      }
      job.log(`Got Items for Giveaway ${giveaway.sk}`);
      job.log(`Finding Items with Shared Contract`);
      const groupedClaimItems = findItemsWithSharedContract(itemsForGiveaway);
      job.log(`Found Items with Shared Contract`);

      const transactionResponses = await sendWearables(groupedClaimItems, claim, nonceManager);
      job.log(`Sent Wearables for Claim ${claim.sk} - ${transactionResponses}`);
      job.log(`${transactionResponses}`);
      const successfulResponses: { success: boolean; transaction: ContractTransaction | any }[] = transactionResponses.filter((response) => response?.success && response?.transaction);
      await Promise.all(
        successfulResponses.map(async (response) => {
          await updateUserGiveawayTransactionList(claim.giveawayId, claim.userId, [response.transaction.hash]);

          job.log(`Transaction Hash: ${response.transaction.hash}`);
        })
      );
      await increaseClaimCountOfGiveaway(claim.giveawayId, successfulResponses.length);
      job.log(`Increased Claim Count for Giveaway ${claim.giveawayId}`);
      const allocation = await getCreditAllocationByGiveawayId(claim.giveawayId);
      if (allocation && allocation?.sk) {
        await decreaseCreditAllocationOfGiveaway(allocation.sk, successfulResponses.length);
      }
      job.log(`Decreased Credit Allocation for Giveaway ${claim.giveawayId}`);
      const transactions = successfulResponses.map((response) => response.transaction);
      job.log(`Finished processing Claim ${claim.sk}`);
      transactionStates.push({ success: true, transactions, claim });
    } catch (error) {
      job.log(`Error processing Claim`);
      job.log(`${error}`);
      console.error("Error processing claim", error);
      transactionStates.push({
        success: false,
        transactions: [],
        claim,
      });
    }
  }

  const updatedTransactions = await Promise.all(
    transactionStates.map(async (transactionState) => {
      job.log(`Processing Transaction State`);
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
