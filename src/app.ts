import { Queue, Worker, QueueScheduler, FlowProducer } from "bullmq";
import { DateTime } from "luxon";
import express from "express";
import Arena from "bull-arena";
import balance from "./queues/Balance.queue";
import claims from "./queues/Claim.queue";
import notifications from "./queues/Notification.queue";
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
    ],
  });

  app.use("/", arena);

  // app.listen(3000, () => {
  //   console.log("Server started on port 3000");
  // });
}

// balanceFlow.add({
//   name: "Balance Check Flow",
//   queueName: balanceCheckQueue.name,
//   data: { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" }, // This data will be dynamically populated based on the result of the parent job
//   opts: {},
//   children: [
//     // {
//     //   name: "Check Wallet Balance",
//     //   queueName: balanceCheckQueue.name,
//     //   data: { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" }, // This data will be dynamically populated based on the result of the parent job
//     //   opts: {},
//     // },
//     {
//       name: "Send Notification - Balance Check",
//       queueName: notificationQueue.name,
//       // data: {}, // This data will be dynamically populated based on the result of the parent job
//       opts: {},
//     },
//   ],
// });

// analyticsFlow.add({
//   name: "Analytics Aggregation Flow",
//   queueName: analyticsAggregationQueue.name,
//   data: { date: DateTime.now().minus({ days: 1 }).toUnixInteger() },
//   opts: {},
//   children: [
//     // {
//     //   name: "Create Daily Analytics Aggregate",
//     //   queueName: analyticsAggregationQueue.name,
//     //   opts: {},
//     // },
//     {
//       name: "Send Notification - Daily Analytics Aggregate Complete",
//       queueName: notificationQueue.name,
//       data: {},
//       opts: {},
//     },
//   ],
// });

// analyticsAggregationQueue.add("Analytics Aggregation Flow", {}, { repeat: { cron: "0 0 * * *" } });
// balanceCheckQueue.add("Check Wallet Balance", {}, { repeat: { cron: "0 13 * * *" } });
// balanceCheckQueue.add("Check Wallet Balance", { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" }, {});

const setupBullQueues = async () => {
  analytics.setupSchedule();
  balance.setupSchedule();
  claims.setupSchedule();

  const analyticsAggregationWorker = new Worker(analytics.queue.name, resolveWorkerPath("Analytics.worker"), { connection });

  const balanceCheckWorker = new Worker(balance.queue.name, resolveWorkerPath("Balance.worker"), { connection });

  const claimWorker = new Worker(claims.queue.name, resolveWorkerPath("Claim.worker"), { connection });

  const transactionWorker = new Worker(claims.queue.name, resolveWorkerPath("Transaction.worker"), { connection });

  const notificationWorker = new Worker(notifications.queue.name, resolveWorkerPath("Discord.worker"), { connection });

  analyticsAggregationWorker.on("completed", async (job) => {
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  analyticsAggregationWorker.on("failed", async (job) => {
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  balanceCheckWorker.on("completed", async (job, result) => {
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  balanceCheckWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  claimWorker.on("completed", async (job, result) => {
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  claimWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  transactionWorker.on("completed", async (job, result) => {
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  transactionWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
    console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  notificationWorker.on("completed", async (job) => {
    console.log(`Job completed with result ${JSON.stringify(job.returnvalue)}`);
  });

  notificationWorker.on("failed", async (job) => {
    // console.log(`Job failed with reason ${JSON.stringify(job.failedReason)}`);
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
