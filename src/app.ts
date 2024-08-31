import { Queue, Worker, QueueScheduler, FlowProducer, QueueEvents } from "bullmq";
import { DateTime } from "luxon";
import express from "express";
import Arena from "bull-arena";
import balance from "./queues/Balance.queue";
import claims from "./queues/Claim.queue";
import consolidation from "./queues/Consolidation.queue";
import notifications from "./queues/Notification.queue";
import transactions from "./queues/Transactions.queue";
import analytics from "./queues/Analytics.queue";
import { connection } from "./services/Redis.service";
import path from "path";
import { getAllSceneIds, getAnalyticsActionsForScene, getLatestAnalyticsAggregate } from "./services/Analytics.service";

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

export const generateDateRange = (startDateTime: number) => {
  const dates = [];

  // Convert the startDateTime to a Luxon DateTime object
  let currentDate = DateTime.fromMillis(startDateTime).startOf("day");

  // Get yesterday's date, starting from midnight
  const yesterday = DateTime.now().minus({ days: 1 }).startOf("day");

  // Loop through each day, adding to the array
  while (currentDate <= yesterday) {
    dates.push(currentDate.toISODate()); // Add the date as an ISO string (yyyy-mm-dd)
    currentDate = currentDate.plus({ days: 1 }); // Move to the next day
  }

  return dates;
};

const migrateOldData = async () => {
  const sceneIds: string[] = await getAllSceneIds();
  console.log(`Found ${sceneIds.length} Scene IDs`);
  const datesToAggregate = new Set<string>();
  if (!sceneIds?.length) {
    return {
      success: false,
      message: `No scene IDs found to aggregate data for ${DateTime.now().minus({ days: 1 }).toUTC().toISODate()}`,
    };
  }

  sceneIds.forEach(async (sceneId) => {
    const lastAggregateCreated = await getLatestAnalyticsAggregate(sceneId);

    if (!lastAggregateCreated) {
      return;
    }

    const dateRange = generateDateRange(lastAggregateCreated?.startDateTime);
    dateRange.forEach((date) => date && datesToAggregate.add(date));
  });

  datesToAggregate.forEach(async (date) => {
    console.log(`Getting Old Analytics Actions for ${date}`);

    await Promise.all(
      sceneIds.map(async (sceneId) => {
        const startDate = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: "utc" }).startOf("day").toMillis(),
          endDate = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: "utc" }).endOf("day").toMillis();
        const analyticsActions = await getAnalyticsActionsForScene({ sceneId, startDate, endDate });

        if (analyticsActions.length > 0) {
          console.log(`Creating Aggregation Job for ${sceneId} ${date}`);
          analytics.addJob(`Create Analytics Aggregate`, { date, nonce: sceneId });
        } else {
          // console.log(`0 actions to aggregate for ${sceneId} ${date}`);
        }
      })
    );
  });
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
  consolidation.setupSchedule();
  transactions.setupSchedule();

  const analyticsAggregationWorker = new Worker(analytics.queue.name, resolveWorkerPath("Analytics.worker"), { connection });

  const balanceCheckWorker = new Worker(balance.queue.name, resolveWorkerPath("Balance.worker"), { connection });

  const claimWorker = new Worker(claims.queue.name, resolveWorkerPath("Claim.worker"), { connection });

  const transactionWorker = new Worker(transactions.queue.name, resolveWorkerPath("Transaction.worker"), { connection });

  const notificationWorker = new Worker(notifications.queue.name, resolveWorkerPath("Discord.worker"), { connection });

  const consolidationWorker = new Worker(notifications.queue.name, resolveWorkerPath("Consolidation.worker"), { connection });

  balance.addJob("Initial Balance Check", { wallet: process.env.GIVEAWAY_WALLET_A, name: "Giveaway Wallet A" });

  analyticsAggregationWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    // console.log(`Job completed with result ${JSON.stringify(result)}`);
    await notifications.addJob(`Send Notification - Aggregate Created`, result);
  });

  analyticsAggregationWorker.on("failed", async (job) => {
    console.log(`Analytics Job failed ${job.data}`);
    await notifications.addJob(`Send Notification - Analytics Job Failed`, { message: job.failedReason });
    console.log(job.failedReason);
  });

  balanceCheckWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Balance Check Job completed`);
  });

  balanceCheckWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Balance Check`, result);
    console.log(`Balance Check Job failed`);
  });

  claimWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    if (result.gasLimited) {
      console.log(`Gas price too high. Skipping Claims`);
      await notifications.addJob(`Send Notification - Gas Price Over Limit`, result);
      return;
    }
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Claim job completed. | Success: ${result.success} | Message: ${result.message}`);
  });

  claimWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - Claims Check`, result);
    console.log(`Claim Job failed with reason ${job.failedReason}`);
  });

  consolidationWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    await notifications.addJob(`Send Notification - User/Tx Consolidation`, result);
    console.log(`Consolidation job completed. | Success: ${result.success} | Message: ${result.message}`);
  });

  consolidationWorker.on("failed", async (job, result) => {
    await notifications.addJob(`Send Notification - User/Tx Consolidation`, result);
    console.log(`Consolidation Job failed with reason ${job.failedReason}`);
  });

  transactionWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
    console.log(`Transaction Job completed`);
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
  });

  transactionWorker.on("failed", async (job, result) => {
    if (!result || !result.message) return;
    console.log(`Transaction Job failed`);
    await notifications.addJob(`Send Notification - Transaction Updater`, result);
  });

  notificationWorker.on("completed", async (job, result) => {
    if (!result || !result.message) return;
  });

  notificationWorker.on("failed", async (job) => {
    console.log(`Notification Job failed`);
  });

  process.on("SIGTERM", async () => {
    console.info("SIGTERM signal received: closing queues");

    await balanceCheckWorker.close();
    await notificationWorker.close();
    await claimWorker.close();
    await consolidationWorker.close();
    await transactionWorker.close();
    await analyticsAggregationWorker.close();

    console.info("All closed");
  });
};

setupBullQueues();
setupBullArena();
// migrateOldData();

// const pendingAirdrops = getPendingAirdropTransactions();
// console.log("Checking for pending airdrops...");
// pendingAirdrops.then((transactions) => {
//   console.log(`Found ${transactions.length} pending transactions`);
//   transactions[0].blockchainTxIds.forEach((txId) => {
//     console.log(txId);
//     getBlockchainTransactionStatus(txId, transactions[0].ts)
//       .then((status) => {
//         console.log(status);
//       })
//       .catch((err) => {
//         console.error(err);
//       });
//   });
// });
