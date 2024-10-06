import { Job } from "bullmq";
import axios from "axios";

interface DiscordJobData {
  message: string;
  channel: string;
}

// Internal message queue and warning threshold
const messageQueue: Partial<DiscordJobData>[] = [];
const WARNING_THRESHOLD = 1000; // Set this to a suitable limit for your system
let warningSent = false;

// Function to send a message from the queue once per second
setInterval(async () => {
  if (messageQueue.length > 0) {
    const messageObj = messageQueue.shift();
    if (messageObj) {
      try {
        let webhook;
        switch (messageObj.channel) {
          case "analytics":
            webhook = process.env.DISCORD_ANALYTICS_JOBS_WEBHOOK;
            break;
          case "giveaway":
            webhook = process.env.DISCORD_GIVEAWAY_JOBS_WEBHOOK;
            break;
          case "transactions":
            webhook = process.env.DISCORD_TRANSACITONS_WEBHOOK;
            break;
          case "tier-limit":
            webhook = process.env.DISCORD_TIER_LIMITING_WEBHOOK;
            break;
          default:
            webhook = process.env.DISCORD_ERROR_WEBHOOK;
            break;
        }

        await axios.post(webhook as string, {
          content: messageObj.message,
        });
      } catch (error) {
        console.error(`Failed to send message to ${messageObj.channel} channel: ${messageObj.message}`, error);
        // Requeue the message in case of failure
        messageQueue.unshift(messageObj);
      }
    }
  }
}, 1000); // Run once per second

// Worker to handle jobs
const worker = async (job: Job<DiscordJobData>) => {
  const messageObj: Partial<DiscordJobData> = { message: job.data?.message, channel: job.data?.channel || process.env.DISCORD_DEFAULT_CHANNEL };

  if (!messageObj.channel) {
    console.log(job);
    throw new Error("No message provided");
  }
  if (!messageObj.message) {
    console.log(job);
    throw new Error("No message provided");
  }

  // Queue the message
  messageQueue.push(messageObj);

  // Check queue length against the warning threshold
  if (messageQueue.length >= WARNING_THRESHOLD && warningSent === false) {
    console.warn(`Warning: Message queue length is ${messageQueue.length}, which exceeds the threshold of ${WARNING_THRESHOLD}. Check your logic to ensure no issues are causing a backlog.`);

    // Optional: Send a notification about the warning to Discord
    try {
      await axios.post(process.env.DISCORD_ERROR_WEBHOOK as string, {
        content: `⚠️ Warning: Message queue length has reached ${messageQueue.length}. Please check the server for potential issues.`,
      });
      warningSent = true;
    } catch (error) {
      console.error("Failed to send warning to Discord:", error);
    }
  } else if (messageQueue.length < WARNING_THRESHOLD && warningSent === true) {
    warningSent = false;
  }
};

export default worker;
