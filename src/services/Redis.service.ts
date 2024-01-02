export const connection = {
  host: (process.env.REDIS_HOST as string) || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
};
