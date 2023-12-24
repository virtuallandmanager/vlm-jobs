import { Queue, QueueScheduler } from "bullmq";
import connection from "../config/redis";
import { DateTime } from "luxon";

const queue = new Queue("notification-queue", {
  connection,
});

export const scheduler = new QueueScheduler(queue.name, {
  connection,
});

export const addJob = async (name: string, data: any) => {
  await queue.add(name, data, {
    jobId: DateTime.now().toISO(),
  });
};

export default { queue, scheduler, addJob };
