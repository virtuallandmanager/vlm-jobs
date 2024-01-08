import { Queue, QueueScheduler } from "bullmq";
import { connection } from "../services/Redis.service";

const queue = new Queue("claim-queue", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const setupSchedule = async () => {
  await queue.add(
    `Process Giveaway Claims`,
    { type: "processPendingClaims" },
    {
      repeat: {
        pattern: "* * * * *",
      },
      jobId: "periodic-claim-check",
    }
  );

  await queue.add(
    `Rejuvenate Giveaway Claims w/ Insufficient Balance`,
    { type: "rejuvenateClaims" },
    {
      repeat: {
        pattern: "0 0 * * *",
      },
      jobId: "periodic-claim-check",
    }
  );
};

export default { queue, scheduler, setupSchedule };
