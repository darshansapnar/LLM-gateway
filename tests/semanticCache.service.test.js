// Integration test for ensureSemanticIndex() - confirms it can build the
// vector index from nothing on an empty Redis (the exact situation a fresh
// `docker compose up` creates with a brand new redis-stack-server
// container, and the case that was silently broken before: see
// ensureSemanticIndex()'s comment in semanticCache.service.js). Needs a
// real reachable Redis with the RediSearch module - REDIS_URL, defaults to
// redis://localhost:6379 (see src/config/redis.js). Run via `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redis, connectRedis } from "../src/config/redis.js";
import { ensureSemanticIndex } from "../src/services/semanticCache.service.js";

const INDEX_NAME = "idx:cache:sem";

async function indexExists() {
  const indexes = await redis.call("FT._LIST");
  return indexes.includes(INDEX_NAME);
}

test("ensureSemanticIndex builds the index on an empty Redis, and starting again is safe", async () => {
  await connectRedis();

  // Start from the same "nothing here yet" state a fresh container has.
  await redis.call("FT.DROPINDEX", INDEX_NAME).catch(() => {});
  assert.equal(await indexExists(), false, "setup: index should not exist yet");

  // This is the call src/index.js makes on every gateway startup - it must
  // complete without throwing, the same as the process needing to come up
  // cleanly on a fresh container.
  await assert.doesNotReject(ensureSemanticIndex());
  assert.equal(await indexExists(), true, "index should exist after ensureSemanticIndex()");

  // A second startup (e.g. a container restart, or a second replica) must
  // also be a safe no-op, not an error.
  await assert.doesNotReject(ensureSemanticIndex());
  assert.equal(await indexExists(), true, "index should still exist after calling it again");

  await redis.quit();
});
