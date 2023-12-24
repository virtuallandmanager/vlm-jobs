import { Job } from "bullmq";
import axios, { AxiosResponse } from "axios";
import notifications from "../queues/Notification.queue";
import { connection } from "../services/Redis.service";

interface DiscordJobData {
  message: string;
}

const worker = async (job: Job<DiscordJobData>) => {
  const { message } = job.data;
  if (!message) {
    console.log(job);
    throw new Error("No message provided");
  }
  try {
    console.log(`Sending Discord message: ${message}`);
    await axios.post(process.env.DISCORD_WEBHOOK_URL as string, {
      content: message,
    });

    return `Message sent: ${message}`;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export default worker;
