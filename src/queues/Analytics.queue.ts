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
    { date: null },
    {
      repeat: {
        pattern: "0 0 * * *",
      },
      jobId: "nightly-analytics-aggregation",
    }
  );
};

export const addJob = async (name: string, data: any) => {
  const date = data.date || DateTime.now().toISODate();
  const jobId = `${name}:${date}:${DateTime.now().toMillis()}${data.nonce ? `:${data.nonce}` : ""}`;
  console.log("Adding Job: " + name);
  await queue.add(name, data, {
    jobId,
  });
};

export default { queue, scheduler, setupSchedule, addJob };
