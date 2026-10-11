import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { createApiKey } from "../../src/services/apiKey.service.js";
import {
  mockProviderSuccess,
  mockProviderError,
  resetAllMocks,
} from "../helpers/mockProviders.js";

let baseUrl;
let rawKey;

before(async () => {
  const env = await setupTestEnvironment();
  baseUrl = env.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
  resetAllMocks();
  const created = await createApiKey({ name: "fallback-client" });
  rawKey = created.rawKey;
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

test("fallback: when primary provider (Groq) fails, router fails over to secondary (Gemini)", async () => {
  // Groq fails with 400 (not retryable, immediately switches to Gemini)
  mockProviderError("groq", 400, "Groq unavailable");
  mockProviderSuccess("gemini", "Gemini answered after Groq failed");

  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "Tell me a joke" }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.provider, "gemini");
  assert.equal(data.fallbackUsed, true);
  assert.equal(data.response, "Gemini answered after Groq failed");
  assert.equal(data.attempts.length, 2);
  assert.equal(data.attempts[0].provider, "groq");
  assert.equal(data.attempts[0].success, false);
  assert.equal(data.attempts[1].provider, "gemini");
  assert.equal(data.attempts[1].success, true);
});

test("fallback: when all providers fail, returns 502 with full attempts history", async () => {
  mockProviderError("groq", 400, "Groq fatal error");
  mockProviderError("gemini", 400, "Gemini fatal error");

  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "Tell me a joke" }),
  });

  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.error, "All providers failed");
  assert.equal(data.attempts.length, 2);
  assert.equal(data.attempts[0].provider, "groq");
  assert.equal(data.attempts[1].provider, "gemini");
});
