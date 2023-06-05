import express from "express";
import Arena from "bull-arena";
import { Queue } from "bullmq";

export const arena = Arena(
  {
    BullMQ: Queue,
    queues: [
      {
        type: "bullmq",

        // Name of the bullmq queue, this name must match up exactly with what you've defined in bullmq.
        name: "decentraland-queue",

        // Hostname or queue prefix, you can put whatever you want.
        hostId: "airdrops",

        // Redis auth.
        redis: {
          port: 6379,
          host: "vlm-redis",
        },
      },
    ],
  },
  {
    // Make the arena dashboard become available at {my-site.com}/arena.
    basePath: "/admin",
    disableListen: true,
  }
);
const app = express();

// Use the router in your Express app
app.use("/", arena);

const port = 4567;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
