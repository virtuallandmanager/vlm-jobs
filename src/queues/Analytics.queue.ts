import { Queue, QueueScheduler } from "bullmq";
import { DateTime } from "luxon";
import { connection } from "../services/Redis.service";

const queue = new Queue("analytics-aggregation", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const setupSchedule = async () => {
  await queue.add(
    `Create Daily Analytics Aggregate`,
    { date: DateTime.now().toISODate() },
    {
      repeat: {
        pattern: "0 0 * * *",
      },
      jobId: 'nightly-analytics-aggregation',
    }
  );
};

export default { queue, scheduler, setupSchedule };
