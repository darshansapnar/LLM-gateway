// Integration test for ensureSemanticIndex() - confirms it can build the
// vector index from nothing on an empty Redis (the exact situation a fresh
// `docker compose up` creates with a brand new redis-stack-server container).
import { test } from "node:test";
import assert from "node:assert/strict";
import { redis, connectRedis } from "../../src/config/redis.js";
import { ensureSemanticIndex } from "../../src/services/semanticCache.service.js";

const INDEX_NAME = "idx:cache:sem";

async function indexExists() {
  const indexes = await redis.call("FT._LIST");
  return indexes.includes(INDEX_NAME);
}

test("ensureSemanticIndex builds the index on an empty Redis, and starting again is safe", async () => {
  await connectRedis();
  // REDIS_URL always resolves to DB 0 in test mode (RediSearch only works
  // there), so no explicit SELECT is needed.

  // Start from the same "nothing here yet" state a fresh container has.
  await redis.call("FT.DROPINDEX", INDEX_NAME).catch(() => {});
  assert.equal(await indexExists(), false, "setup: index should not exist yet");

  // This is the call src/index.js makes on every gateway startup - it must
  // complete without throwing.
  await assert.doesNotReject(ensureSemanticIndex());
  assert.equal(await indexExists(), true, "index should exist after ensureSemanticIndex()");

  // A second startup (e.g. container restart or replica) must also be a safe no-op.
  await assert.doesNotReject(ensureSemanticIndex());
  assert.equal(await indexExists(), true, "index should still exist after calling it again");

  await redis.quit();
});
