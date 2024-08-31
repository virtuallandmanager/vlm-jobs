import { Queue, QueueScheduler } from "bullmq";
import { connection } from "../services/Redis.service";

const queue = new Queue("consolidation-queue", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const setupSchedule = async () => {
  await queue.add(
    `Consolidate Claims for Users`,
    { type: "consolidateClaims" },
    {
      repeat: {
        pattern: "0 0 * * *",
      },
      jobId: "periodic-claim-consolidation",
    }
  );
};

export default { queue, scheduler, setupSchedule };
