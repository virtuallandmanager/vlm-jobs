import { Alchemy, Network } from "alchemy-sdk";
import { Accounting } from "../models/Accounting.model";

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

export const getBlockchainTransactionStatus = async (txHash: string, alchemyProvider?: Alchemy): Promise<Accounting.TransactionStatus> => {
  try {
    const provider = alchemyProvider || alchemyMatic;
    const txReceipt = await provider.core.getTransactionReceipt(txHash);
    if (txReceipt) {
      // Transaction is confirmed - 1 for success, 0 for failure
      return txReceipt.status ? Accounting.TransactionStatus.COMPLETED : Accounting.TransactionStatus.FAILED;
    } else {
      // Transaction is not confirmed yet
      return Accounting.TransactionStatus.PENDING;
    }
  } catch (error) {
    console.error("Error checking transaction status:", error);
    throw error;
  }
};
