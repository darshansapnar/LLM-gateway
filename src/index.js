// Entry point of the app: connects to the database, then starts the server.
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./config/redis.js";
import { ensureSemanticIndex } from "./services/semanticCache.service.js";

async function start() {
  await connectDB();
  await connectRedis();

  if (env.SEMANTIC_CACHE_ENABLED) {
    await ensureSemanticIndex();
  }

  app.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
  });
}

start();
