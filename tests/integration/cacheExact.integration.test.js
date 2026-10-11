import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { createApiKey } from "../../src/services/apiKey.service.js";
import { mockProviderSuccess, resetAllMocks } from "../helpers/mockProviders.js";

let baseUrl;
let rawKey;

before(async () => {
  const env = await setupTestEnvironment();
  baseUrl = env.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
  resetAllMocks();
  const created = await createApiKey({ name: "cache-exact-client" });
  rawKey = created.rawKey;
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

test("exactCache: first request is MISS, second is HIT-EXACT with cost 0, bypass returns BYPASS", async () => {
  const calls = mockProviderSuccess("groq", "Exact answer about databases", {
    inputTokens: 15,
    outputTokens: 25,
  });

  const prompt = "What is ACID compliance?";

  // 1. First request -> MISS
  const res1 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt }),
  });

  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get("x-cache"), "MISS");
  const data1 = await res1.json();
  assert.equal(data1.cached, false);
  assert.equal(data1.cacheType, "none");
  assert.equal(data1.response, "Exact answer about databases");
  assert.equal(calls.length, 1, "Provider should be called on cache miss");

  // 2. Second request with identical prompt -> HIT-EXACT
  const res2 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt }),
  });

  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-cache"), "HIT-EXACT");
  const data2 = await res2.json();
  assert.equal(data2.cached, true);
  assert.equal(data2.cacheType, "exact");
  assert.equal(data2.costUsd, 0, "Cached response must cost $0");
  assert.equal(data2.tokensSaved, 40, "15 input + 25 output = 40 tokens saved");
  assert.equal(calls.length, 1, "Provider must NOT be called on exact cache hit");

  // 3. Third request with x-cache-bypass: true -> BYPASS
  const res3 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
      "x-cache-bypass": "true",
    },
    body: JSON.stringify({ prompt }),
  });

  assert.equal(res3.status, 200);
  assert.equal(res3.headers.get("x-cache"), "BYPASS");
  const data3 = await res3.json();
  assert.equal(data3.cached, false);
  assert.equal(calls.length, 2, "Provider must be called when cache is bypassed");
});
