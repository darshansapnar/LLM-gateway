// Helper for setting up isolated MongoDB and Redis test databases,
// managing test HTTP server lifecycle, and cleaning up state.
process.env.NODE_ENV = "test";

import mongoose from "mongoose";
import app from "../../src/app.js";
import { connectDB } from "../../src/config/db.js";
import { redis, connectRedis } from "../../src/config/redis.js";
import { ApiKey } from "../../src/models/ApiKey.js";
import { RequestLog } from "../../src/models/RequestLog.js";

let serverInstance = null;

export async function setupTestEnvironment() {
  process.env.NODE_ENV = "test";
  await connectDB();
  await connectRedis();

  if (!serverInstance) {
    await new Promise((resolve) => {
      serverInstance = app.listen(0, resolve);
    });
  }

  const port = serverInstance.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return { server: serverInstance, baseUrl };
}

export async function cleanTestDb() {
  if (mongoose.connection.readyState === 1) {
    await Promise.all([
      ApiKey.deleteMany({}),
      RequestLog.deleteMany({}),
    ]);
  }

  if (redis.status === "ready") {
    // REDIS_URL always points at DB 0 in test mode (RediSearch only works
    // there), so there is only ever one DB to flush.
    await redis.flushdb();
  }
}

export async function teardownTestEnvironment() {
  await cleanTestDb();

  if (serverInstance) {
    await new Promise((resolve) => serverInstance.close(resolve));
    serverInstance = null;
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (redis.status === "ready") {
    await redis.quit();
  }
}
