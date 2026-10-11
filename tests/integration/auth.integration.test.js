import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { createApiKey } from "../../src/services/apiKey.service.js";
import { mockProviderSuccess, resetAllMocks } from "../helpers/mockProviders.js";
import { ApiKey } from "../../src/models/ApiKey.js";

let baseUrl;

before(async () => {
  const env = await setupTestEnvironment();
  baseUrl = env.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
  resetAllMocks();
  mockProviderSuccess("groq", "Mock answer from Groq");
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

test("auth: rejects request with 401 when Authorization header is missing", async () => {
  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Hello" }),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Missing or malformed Authorization header");
});

test("auth: rejects request with 401 when Authorization header does not start with Bearer", async () => {
  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic some_basic_token",
    },
    body: JSON.stringify({ prompt: "Hello" }),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Missing or malformed Authorization header");
});

test("auth: rejects request with 401 when key is invalid / not in database", async () => {
  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer gw_00000000000000000000000000000000",
    },
    body: JSON.stringify({ prompt: "Hello" }),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Invalid or inactive API key");
});

test("auth: rejects request with 401 when key exists but isActive is false", async () => {
  const { key, rawKey } = await createApiKey({ name: "deactivated-client" });
  await ApiKey.findByIdAndUpdate(key._id, { isActive: false });

  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "Hello" }),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Invalid or inactive API key");
});

test("auth: succeeds with 200 when valid active key is provided", async () => {
  const { rawKey } = await createApiKey({ name: "active-client" });

  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "Hello" }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.response, "Mock answer from Groq");
});
