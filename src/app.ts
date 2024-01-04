import { Queue, Worker, QueueScheduler, FlowProducer } from "bullmq";
import { DateTime } from "luxon";
import express from "express";
import Arena from "bull-arena";
import balance from "./queues/Balance.queue";
import claims from "./queues/Claim.queue";
import notifications from "./queues/Notification.queue";
import transactions from "./queues/Transactions.queue";
import analytics from "./queues/Analytics.queue";
import { connection } from "./services/Redis.service";
import path from "path";

export function resolveWorkerPath(workerFileName: string): string {
  if (process.env.NODE_ENV === "production") {
    // In production, use the compiled JavaScript files in the 'dist' folder
    return path.join(__dirname, "workers", workerFileName);
  } else {
    // In development, use the TypeScript files directly from the 'src' folder
    return path.join(__dirname, "..", "src", "workers", `${workerFileName}.ts`);
  }
}

// import redis from "./config/redis";
// import axios from 'axios';
// import "./queues"
// import "./workers";
// import "./schedules"

// function generateDaysForYear(year: number): EpochTimeStamp[] {
//   const isoStrings: EpochTimeStamp[] = [];
//   let currentDate = DateTime.local(year, 1, 1);

//   while (currentDate.year === year) {
//     if (currentDate.isValid) {
//       isoStrings.push(currentDate.toUnixInteger()); // Get the ISO date string
//       currentDate = currentDate.plus({ days: 1 }); // Increment to the next day
//     }
//   }

//   return isoStrings;
// }

async function setupBullArena() {
  const app = express();
  const arena = Arena({
    BullMQ: Queue,
    queues: [
      {
        type: "bullmq",

        name: analytics.queue.name,

        hostId: "VLM",

        redis: connection,
      },
      {
        type: "bullmq",

        name: balance.queue.name,

        hostId: "VLM",

        redis: connection,
      },
      {
        type: "bullmq",

        name: claims.queue.name,

        hostId: "VLM",

        redis: connection,
      },
      {
        type: "bullmq",

        name: notifications.queue.name,

        hostId: "VLM",

        redis: connection,
      },
      {
        type: "bullmq",

        name: transactions.queue.name,

        hostId: "VLM",

        redis: connection,
      },
    ],
  });

  app.use("/", arena);
}

const setupBullQueues = async () => {
  analytics.setupSchedule();
  balance.setupSchedule();
  claims.setupSchedule();

  const analyticsAggregationWorker = new Worker(analytics.queue.name, resolveWorkerPath("Analytics.worker"), { connection });

  const balanceCheckWorker = new Worker(balance.queue.name, resolveWorkerPath("Balance.worker"), { connection });

  const claimWorker = new Worker(claims.queue.name, resolveWorkerPath("Claim.worker"), { connection });

  const transactionWorker = new Worker(transactions.queue.name, resolveWorkerPath("Transaction.worker"), { connection });

  const notificationWorker = new Worker(notifications.queue.name, resolveWorkerPath("Discord.worker"), { connection });

  analyticsAggregationWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - Aggregate Created`, result.message);
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  analyticsAggregationWorker.on("failed", async (job) => {
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  balanceCheckWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  balanceCheckWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  claimWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  claimWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  transactionWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
  });

  transactionWorker.on("failed", async (job, result) => {
    if (!result || !result.message) return;

    await notifications.addJob(`Send Notification - Transaction Updater`, result);
  });

  notificationWorker.on("completed", async (job) => {
  });

  notificationWorker.on("failed", async (job) => {
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  process.on("SIGTERM", async () => {
    console.info("SIGTERM signal received: closing queues");

    await balanceCheckWorker.close();
    await notificationWorker.close();

    console.info("All closed");
  });
};

setupBullQueues();
setupBullArena();
