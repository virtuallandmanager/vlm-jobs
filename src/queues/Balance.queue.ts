import { Queue, QueueScheduler } from "bullmq";
import connection from "../config/redis";
import { DateTime } from "luxon";

const queue = new Queue("wallet-balance-check", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const setupSchedule = async () => {
  await queue.add(
    `Check Wallet Balance`,
    { wallet: process.env.GIVEAWAY_WALLET_A },
    {
      repeat: {
        pattern: "0 13 * * *",
      },
      jobId: "daily-balance-check",
    }
  );
};

export default { queue, scheduler, setupSchedule };
