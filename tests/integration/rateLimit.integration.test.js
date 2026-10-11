import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { createApiKey } from "../../src/services/apiKey.service.js";
import { addTokenUsage } from "../../src/services/rateLimit.service.js";
import { mockProviderSuccess, resetAllMocks } from "../helpers/mockProviders.js";

let baseUrl;

before(async () => {
  const env = await setupTestEnvironment();
  baseUrl = env.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
  resetAllMocks();
  mockProviderSuccess("groq", "Mock answer");
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

test("rateLimit: enforces requestsPerMinute limit with 429 and Retry-After", async () => {
  const { rawKey } = await createApiKey({
    name: "rpm-limited-client",
    requestsPerMinute: 2,
    tokensPerDay: 100000,
  });

  const send = () =>
    fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawKey}`,
      },
      body: JSON.stringify({ prompt: "Hello" }),
    });

  // Request 1: Allowed
  const res1 = await send();
  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get("x-ratelimit-limit"), "2");
  assert.equal(res1.headers.get("x-ratelimit-remaining"), "1");

  // Request 2: Allowed
  const res2 = await send();
  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-ratelimit-remaining"), "0");

  // Request 3: Blocked by rate limiter!
  const res3 = await send();
  assert.equal(res3.status, 429);
  assert.ok(res3.headers.get("retry-after"), "Retry-After header must be present on 429");
  const data3 = await res3.json();
  assert.match(data3.error, /Rate limit exceeded: max 2 requests per minute/);
});

test("rateLimit: enforces tokensPerDay daily limit with 429 and Retry-After", async () => {
  const { key, rawKey } = await createApiKey({
    name: "token-limited-client",
    requestsPerMinute: 100,
    tokensPerDay: 50,
  });

  // Simulate that the key already consumed 60 tokens today
  await addTokenUsage(key._id, 60);

  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "Hello" }),
  });

  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"), "Retry-After header must be present on daily token 429");
  const data = await res.json();
  assert.match(data.error, /Daily token limit exceeded: max 50 tokens per day/);
});
