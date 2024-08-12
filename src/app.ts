import { Queue, Worker, QueueScheduler, FlowProducer, QueueEvents } from "bullmq";
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
import { getAllSceneIds, getAnalyticsActionsForScene } from "./services/Analytics.service";

// const __dirname = path.dirname(__filename);

export function resolveWorkerPath(workerFileName: string): string {
  if (process.env.NODE_ENV === "production") {
    // In production, use the compiled JavaScript files in the 'dist' folder
    return path.join(__dirname, "..", "dist", "workers", `${workerFileName}.js`);
  } else {
    // In development, use the TypeScript files directly from the 'src' folder
    return path.join(__dirname, "..", "dist", "workers", `${workerFileName}.js`);
  }
}

function generateDaysForYear(year: number): string[] {
  const isoStrings: string[] = [];
  let currentDate = DateTime.local(year, 1, 1);

  while (currentDate.year === year) {
    if (currentDate.isValid) {
      isoStrings.push(currentDate.toISODate()); // Get the ISO date string
      currentDate = currentDate.plus({ days: 1 }); // Increment to the next day
    }
  }

  isoStrings.splice(0, 90);
  isoStrings.splice(-141);

  return isoStrings;
}

const migrateOldData = async () => {
  const sceneIds: string[] = await getAllSceneIds(),
    days = generateDaysForYear(2024);
  console.log(`Found ${sceneIds.length} Scene IDs`);

  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    if (sceneIds.length < 1) {
      return {
        success: false,
        message: `No scene IDs found`,
      };
    }

    const startDate = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: "utc" }).startOf("day").toMillis(),
      endDate = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: "utc" }).endOf("day").toMillis();
    let allAggregates;

    if (!sceneIds?.length) {
      return {
        success: false,
        message: `No scene IDs found to aggregate data for ${DateTime.now().minus({ days: 1 }).toUTC().toISODate()}`,
      };
    }
    console.log(`Getting Old Analytics Actions for ${date}`);

    await Promise.all(
      sceneIds.map(async (sceneId) => {
        const analyticsActions = await getAnalyticsActionsForScene({ sceneId, startDate, endDate });

        if (analyticsActions.length > 0) {
          console.log(`Creating Aggregation Job for ${sceneId} ${date}`);
          analytics.addJob(`Create Daily Analytics Aggregate - Migration`, { date, nonce: sceneId });
        } else {
          // console.log(`0 actions to aggregate for ${sceneId} ${date}`);
        }
      })
    );
  }
};

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
  const date = DateTime.now().minus({ days: 1 }).toUTC().toISODate();
  analytics.setupSchedule();
  balance.setupSchedule();
  claims.setupSchedule();
  transactions.setupSchedule();

  const analyticsAggregationWorker = new Worker(analytics.queue.name, resolveWorkerPath("Analytics.worker"), { connection });

  const balanceCheckWorker = new Worker(balance.queue.name, resolveWorkerPath("Balance.worker"), { connection });

  const claimWorker = new Worker(claims.queue.name, resolveWorkerPath("Claim.worker"), { connection });

  const transactionWorker = new Worker(transactions.queue.name, resolveWorkerPath("Transaction.worker"), { connection });

  const notificationWorker = new Worker(notifications.queue.name, resolveWorkerPath("Discord.worker"), { connection });

  balance.addJob("Initial Balance Check", { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" });
  analytics.addJob(`Create Daily Analytics Aggregate`, { date: "2024-08-11" });

  analyticsAggregationWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    // console.log(`Job completed with result ${JSON.stringify(result)}`);
    // await notifications.addJob(`Send Notification - Aggregate Created`, result.message);
  });

  analyticsAggregationWorker.on("failed", async (job) => {
    console.log(`Analytics Job failed with reason ${JSON.stringify(job.failedReason)}`);
  });

  balanceCheckWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Job completed with result ${JSON.stringify(result)}`);
  });

  balanceCheckWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Balance Check Job failed with reason ${job.failedReason}`);
  });

  claimWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    if (result.gasLimited) {
      console.log(`Gas price too high. Skipping Claims`);
      await notifications.addJob(`Send Notification - Gas Price Over Limit`, result.message);
      return;
    }
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Claim job completed. | Success: ${result.success} | Message: ${result.message}`);
  });

  claimWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Claim Job failed with reason ${job.failedReason}`);
  });

  transactionWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    console.log(`Job completed with result ${JSON.stringify(result)}`);
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
  });

  transactionWorker.on("failed", async (job, result) => {
    if (!result || !result.message) return;
    console.log(`Transaction Job failed with reason ${job.failedReason}`);
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
  });

  notificationWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
  });

  notificationWorker.on("failed", async (job) => {
    console.log(`Notification Job failed with reason ${job.failedReason}`);
  });

  process.on("SIGTERM", async () => {
    console.info("SIGTERM signal received: closing queues");

    await balanceCheckWorker.close();
    await notificationWorker.close();
    await claimWorker.close();
    await transactionWorker.close();
    await analyticsAggregationWorker.close();

    console.info("All closed");
  });
};

setupBullQueues();
setupBullArena();
// migrateOldData();
