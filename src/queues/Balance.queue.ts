import { Queue, QueueScheduler } from "bullmq";
import { connection } from "../services/Redis.service";
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
    { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" },
    {
      repeat: {
        pattern: "0 13 * * *",
      },
      jobId: "daily-balance-check",
    }
  );
};

export const addJob = async (name: string, data: any) => {
  await queue.add(name, data, {
    jobId: DateTime.now().toISO(),
  });
};

export default { queue, scheduler, setupSchedule, addJob };
