import { Job } from "bullmq";
import axios from "axios";
import { ethers } from "ethers";

const { Alchemy, Network } = require("alchemy-sdk");

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY_MATIC,  // Replace with your actual Alchemy API key
  network: Network.MATIC_MAINNET,
});

const worker = async (job: Job) => {
  try {
    const walletId = job.data.wallet;
    const walletName = job.data.name || walletId;
    if (!walletId) return { message: "No wallet ID provided" };

    // Fetch the balance
    const balanceInWei = await alchemy.core.getBalance(walletId);
    const balance = Number(ethers.utils.formatUnits(balanceInWei, "ether"));

    console.log(`Balance for wallet ${walletId}: ${balance}`);
    if (balance < 20) {
      return {
        balance,
        message: `<@&1041552453918801973>\n 
        :rotating_light: BALANCE LOW IN ${walletName.toUpperCase()}! :rotating_light:\n
        Balance for wallet ${walletName} is ${balance} MATIC`,
      };
    }
    return { balance, message: `Balance for wallet ${walletName} is ${balance} MATIC` };
  } catch (error) {
    console.error(error);
  }
};

export default worker;
