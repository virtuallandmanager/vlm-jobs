import { Job } from "bullmq";
import axios from "axios";
import { ethers } from "ethers";

const MATIC_API_URL = "https://api.polygonscan.com/api";

const worker = async (job: Job) => {
  try {
    const walletId = job.data.wallet;
    const walletName = job.data.name || walletId;
    if (!walletId) return { message: "No wallet ID provided" };
    const response = await axios.get(`${MATIC_API_URL}?module=account&action=balance&address=${walletId}`);
    const balance = Number(ethers.utils.formatUnits(response.data.result, "ether"));
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
