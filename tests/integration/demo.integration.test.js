import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { mockProviderSuccess, resetAllMocks } from "../helpers/mockProviders.js";
import { redis } from "../../src/config/redis.js";
import { env } from "../../src/config/env.js";
import { RequestLog } from "../../src/models/RequestLog.js";

let baseUrl;

before(async () => {
  const testEnv = await setupTestEnvironment();
  baseUrl = testEnv.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
  resetAllMocks();
  mockProviderSuccess("groq", "Mock demo AI response");
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

test("POST /demo/chat: works without client API key and sets visitorId cookie", async () => {
  const res = await fetch(`${baseUrl}/demo/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "What is an LLM gateway?" }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.response, "Mock demo AI response");
  assert.ok(res.headers.get("x-request-id"));
  assert.equal(res.headers.get("x-pii-mode"), "mask");

  // Check Set-Cookie header contains visitorId
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie && setCookie.includes("visitorId="));

  // Check RequestLog was tagged with isDemo: true, visitorId, and clientIpHash
  const log = await RequestLog.findById(data.requestId);
  assert.ok(log);
  assert.equal(log.isDemo, true);
  assert.ok(log.visitorId);
  assert.ok(log.clientIpHash);
  // Ensure raw IP is never logged
  assert.notEqual(log.clientIpHash, "127.0.0.1");
  assert.equal(log.clientIpHash.length, 64); // SHA-256 hex string
});

test("POST /demo/chat: enforces prompt length limit (DEMO_MAX_PROMPT_CHARS = 500)", async () => {
  const longPrompt = "a".repeat(501);
  const res = await fetch(`${baseUrl}/demo/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: longPrompt }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /exceeds maximum allowed length of 500 characters for demo mode/i);
});

test("POST /demo/chat: enforces per-IP limit (20/hour) with Retry-After", async () => {
  const send = () =>
    fetch(`${baseUrl}/demo/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cache-bypass": "true" },
      body: JSON.stringify({ prompt: "Hello demo" }),
    });

  // Make 20 requests (limit = 20)
  for (let i = 1; i <= 20; i++) {
    const res = await send();
    assert.equal(res.status, 200, `Request ${i} should succeed`);
    assert.equal(res.headers.get("x-ratelimit-limit"), "20");
    assert.equal(res.headers.get("x-ratelimit-remaining"), String(20 - i));
  }

  // 21st request: blocked by hourly per-IP limit
  const resBlocked = await send();
  assert.equal(resBlocked.status, 429);
  assert.ok(resBlocked.headers.get("retry-after"));
  const data = await resBlocked.json();
  assert.match(data.error, /Rate limit exceeded: demo allows max 20 requests per hour per IP/i);
});

test("POST /demo/chat: enforces daily budget with specific 'Demo limit reached for today' message", async () => {
  // Pre-set the daily Redis counter to budget limit (300)
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dailyKey = `rl:demo:daily:${dateStr}`;
  await redis.set(dailyKey, env.DEMO_DAILY_REQUEST_BUDGET);

  const res = await fetch(`${baseUrl}/demo/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Hello daily budget" }),
  });

  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
  const data = await res.json();
  assert.equal(
    data.error,
    "Demo limit reached for today. Please come back tomorrow or use your own API key."
  );
});

test("POST /demo/chat: PII is always masked and never leaked", async () => {
  // Indian phone number and email
  const promptWithPii = "My phone is 9876543210 and email is secret@example.com, please assist.";
  const res = await fetch(`${baseUrl}/demo/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: promptWithPii }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-pii-mode"), "mask");
  assert.equal(res.headers.get("x-pii-redacted"), "2");

  const data = await res.json();
  // Request log stores the masked prompt, never raw PII
  const log = await RequestLog.findById(data.requestId);
  assert.ok(log);
  assert.ok(!log.prompt.includes("9876543210"));
  assert.ok(!log.prompt.includes("secret@example.com"));
  assert.ok(log.prompt.includes("[PHONE_IN_1]"));
  assert.ok(log.prompt.includes("[EMAIL_1]"));
});

test("GET /demo/stats/requests: never returns other visitors' prompts; visitor sees their own requests", async () => {
  // 1. Visitor A makes a demo request
  const visitorACookie = "visitorId=visitor-aaaa-1111-2222";
  const resA = await fetch(`${baseUrl}/demo/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorACookie,
    },
    body: JSON.stringify({ prompt: "Visitor A private prompt" }),
  });
  assert.equal(resA.status, 200);

  // 2. Visitor B queries /demo/stats/requests
  const visitorBCookie = "visitorId=visitor-bbbb-3333-4444";
  const resStatsForB = await fetch(`${baseUrl}/demo/stats/requests`, {
    headers: { Cookie: visitorBCookie },
  });
  assert.equal(resStatsForB.status, 200);
  const dataB = await resStatsForB.json();
  assert.ok(dataB.logs.length >= 1);

  // In Visitor B's view, Visitor A's prompt and response MUST NOT be present
  const logInB = dataB.logs[0];
  assert.equal(logInB.prompt, undefined, "Other visitor's prompt must not be returned");
  assert.equal(logInB.response, undefined, "Other visitor's response must not be returned");
  assert.equal(logInB.isOwner, false);
  // Metadata is still present
  assert.ok(logInB.status);
  assert.ok(logInB.provider);
  assert.ok(logInB.latencyMs !== undefined);

  // 3. Visitor A queries /demo/stats/requests
  const resStatsForA = await fetch(`${baseUrl}/demo/stats/requests`, {
    headers: { Cookie: visitorACookie },
  });
  assert.equal(resStatsForA.status, 200);
  const dataA = await resStatsForA.json();
  assert.ok(dataA.logs.length >= 1);

  // In Visitor A's view, their own request MUST include prompt and response
  const logInA = dataA.logs[0];
  assert.equal(logInA.isOwner, true);
  assert.equal(logInA.prompt, "Visitor A private prompt");
  assert.equal(logInA.response, "Mock demo AI response");
});

test("GET /demo/stats/overview: returns aggregated numbers without admin key", async () => {
  const res = await fetch(`${baseUrl}/demo/stats/overview?range=24h`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.range === "24h");
  assert.ok(typeof data.totalRequests === "number");
  assert.ok(typeof data.successRate === "number");
  assert.ok(typeof data.cacheHitRate === "number");
});

test("admin routes still reject public requests", async () => {
  const adminEndpoints = [
    "/v1/admin/overview",
    "/v1/admin/keys",
    "/v1/admin/logs",
    "/v1/admin/providers",
    "/v1/admin/cache-stats",
  ];

  for (const endpoint of adminEndpoints) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(res.status, 401, `Public request to ${endpoint} should be rejected with 401`);
    const data = await res.json();
    assert.equal(data.error, "Missing or invalid x-admin-key header");
  }
});
