import { Queue, QueueScheduler } from "bullmq";
import { connection } from "../services/Redis.service";

const queue = new Queue("wallet-balance-check", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const setupSchedule = async () => {
  await queue.add(
    `Check Wallet Balance`,
    { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" },
    {
      repeat: {
        pattern: "0 13 * * *",
      },
      jobId: "daily-balance-check",
    }
  );
};

export default { queue, scheduler, setupSchedule };
