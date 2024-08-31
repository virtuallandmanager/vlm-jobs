import { Alchemy, Network } from "alchemy-sdk";
import { Accounting } from "../models/Accounting.model";
import { DateTime } from "luxon";
import { calculateMaticSpent } from "./Transaction.service";

export const maticMainnetConfig = {
  apiKey: process.env.ALCHEMY_API_KEY_MATIC,
  network: Network.MATIC_MAINNET,
};

export const maticMumbaiConfig = {
  apiKey: process.env.ALCHEMY_API_KEY_MUMBAI,
  network: Network.MATIC_MUMBAI,
};

export const ethMainnetConfig = {
  apiKey: process.env.ALCHEMY_API_KEY_ETH,
  network: Network.ETH_MAINNET,
};

export const ethGoerliConfig = {
  apiKey: process.env.ALCHEMY_API_KEY_GOERLI,
  network: Network.ETH_GOERLI,
};

export const alchemyMatic = new Alchemy(maticMainnetConfig);
export const alchemyMumbai = new Alchemy(maticMumbaiConfig);
export const alchemyEth = new Alchemy(ethMainnetConfig);
export const alchemyGoerli = new Alchemy(ethGoerliConfig);

export const getBlockchainTransactionStatus = async (txHash: string, ts?: number, alchemyProvider?: Alchemy | null): Promise<{ status: Accounting.TransactionStatus; txAmount: number }> => {
  try {
    const provider = alchemyProvider || alchemyMatic;
    const txReceipt = await provider.core.getTransactionReceipt(txHash);
    if (txReceipt) {
      console.log("Transaction found in the block.");
      // console.log(txReceipt);
      const txAmount = calculateMaticSpent(txReceipt);
      console.log("Transaction amount:", txAmount);
      // Transaction is confirmed
      return txReceipt?.status ? { status: Accounting.TransactionStatus.COMPLETED, txAmount } : { status: Accounting.TransactionStatus.FAILED, txAmount: 0 };
    } else if (ts && ts < DateTime.now().minus({ hours: 3 }).toMillis()) {
      console.log("Transaction timed out.");
      console.log(txReceipt);
      // Transaction is not confirmed yet
      return { status: Accounting.TransactionStatus.FAILED, txAmount: 0 };
    } else {
      console.log("Transaction not found in the block yet.");
      console.log(txReceipt);
      // Transaction is not confirmed yet
      return { status: Accounting.TransactionStatus.PENDING, txAmount: 0 };
    }
  } catch (error) {
    console.error("Error checking transaction status:", error);
    throw error;
  }
};
