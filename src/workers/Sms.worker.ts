import { Job } from "bullmq";
import { Twilio } from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = new Twilio(accountSid, authToken);

const worker = async (job: Job) => {
  try {
    const balance = job.data.balance;

    if (balance > 30) {
      return;
    }

    console.log(`Sending SMS to ${job.data.to || process.env.TEXT_NOTIFICATION_NUMBER}`);

    const message = await client.messages.create({
      body: `The giveaway account's balance has dropped to ${balance}`,
      from: process.env.TWILIO_NUMBER,
      to: job.data.to || process.env.TEXT_NOTIFICATION_NUMBER,
    });

    console.log(`Message sent with SID: ${message.sid}`);
  } catch (error: any) {
    console.error("Error sending SMS:", error?.message);
  }
};

export default worker;
