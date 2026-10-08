// Connects to Redis. Used for rate-limiting counters (Stage 2).
import Redis from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, { lazyConnect: true });

// Logs any connection issues that happen after startup, so a transient
// network blip doesn't crash the whole process (ioredis requires an
// "error" listener or it throws an unhandled exception).
redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

export async function connectRedis() {
  try {
    await redis.connect();
    console.log("Redis connected");
  } catch (error) {
    console.error("Redis connection failed:", error.message);
    process.exit(1);
  }
}
