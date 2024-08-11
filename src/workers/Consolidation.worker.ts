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
  getLastTwoDaysOfClaims,
} from "../services/Claim.service";
import { Giveaway } from "../models/Giveaway.model";
import { addBlockchainTransactionIds, getTransactionById } from "../services/Transaction.service";
import { ContractTransaction } from "ethers";
import { Accounting } from "../models/Accounting.model";

export let gasLimits: { [key in Accounting.TxLimitsType]?: { unit: string; value: number } } = {};

export let job: Job;

const worker = async (newJob: Job) => {
  newJob.log("Giveaway transaction consolidation job Started.");
  job = newJob;
  const completeClaims = await getLastTwoDaysOfClaims();
  const claimsWithTransactionData = await addTransactionData(completeClaims);
  if (!claimsWithTransactionData?.length) {
    // no incomplete claims found
    job.log("No Claims found to process");
    return {
      success: true,
    };
  }
  claimsWithTransactionData.map(async (claimData) => {
    const { transaction, claim } = claimData,
      blockchainTxIds = transaction?.blockchainTxIds || [];
    await updateUserGiveawayTransactionList(claim.giveawayId, claim.userId, blockchainTxIds);
    return claim;
  });
};

const addTransactionData = async (claims: Giveaway.Claim[]): Promise<{ claim: Giveaway.Claim; transaction: Accounting.Transaction | null }[]> => {
  let claimsWithTransactionData: { claim: Giveaway.Claim; transaction: Accounting.Transaction | null }[] = [];
  if (!claims?.length) {
    // no incomplete claims found
    job.log("No Claims found to add transaction data");
    return [];
  } else {
    return await Promise.all(
      claims.map(
        async (claim: Giveaway.Claim): Promise<{ claim: Giveaway.Claim; transaction: Accounting.Transaction | null }> => {
          const transaction = await getTransactionById(claim.transactionId);
          claimsWithTransactionData.push({ claim, transaction });
          return { claim, transaction: transaction };
        }
      )
    );
  }
};

export default worker;
