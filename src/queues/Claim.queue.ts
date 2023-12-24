import { Queue, QueueScheduler } from "bullmq";
import connection from "../config/redis";
import { DateTime } from "luxon";

const queue = new Queue("claim-queue", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const setupSchedule = async () => {
  await queue.add(
    `Process Giveaway Claims`,
    {},
    {
      repeat: {
        pattern: "* * * * *",
      },
      jobId: 'periodic-claim-check',
    }
  );
};

export default { queue, scheduler, setupSchedule };
