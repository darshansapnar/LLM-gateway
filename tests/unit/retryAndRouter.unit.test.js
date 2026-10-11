import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { connectRedis, redis } from "../../src/config/redis.js";
import {
  isRetryable,
  BASE_BACKOFF_MS,
  askWithFallback,
} from "../../src/services/router.service.js";
import {
  mockProviderSuccess,
  resetAllMocks,
} from "../helpers/mockProviders.js";
import { providers } from "../../src/services/providers/index.js";
import { recordSuccess } from "../../src/services/circuitBreaker.service.js";

// Uses the real Redis connection (DB 0, same as everything else in test
// mode - RediSearch only works on DB 0, so no test may select a different
// one). These tests reset the groq/gemini circuit breaker state before and
// after every test, so leftover state from other test files never matters.
before(async () => {
  await connectRedis();
});

beforeEach(async () => {
  resetAllMocks();
  await recordSuccess("groq");
  await recordSuccess("gemini");
});

afterEach(() => {
  resetAllMocks();
});

after(async () => {
  resetAllMocks();
  await redis.quit();
});

test("isRetryable: identifies transient error codes as retryable", () => {
  assert.equal(isRetryable({ status: 408 }), true, "408 timeout is retryable");
  assert.equal(isRetryable({ status: 429 }), true, "429 rate limit is retryable");
  assert.equal(isRetryable({ status: 500 }), true, "500 internal error is retryable");
  assert.equal(isRetryable({ status: 502 }), true, "502 bad gateway is retryable");
  assert.equal(isRetryable({ status: 503 }), true, "503 service unavailable is retryable");
  assert.equal(isRetryable({ status: 504 }), true, "504 gateway timeout is retryable");
});

test("isRetryable: identifies permanent client errors as non-retryable", () => {
  assert.equal(isRetryable({ status: 400 }), false, "400 bad request must never be retried");
  assert.equal(isRetryable({ status: 401 }), false, "401 unauthorized must never be retried");
  assert.equal(isRetryable({ status: 403 }), false, "403 forbidden must never be retried");
  assert.equal(isRetryable({ status: 404 }), false, "404 not found must never be retried");
  assert.equal(isRetryable({ status: 422 }), false, "422 unprocessable must never be retried");
  assert.equal(isRetryable({}), false, "error without status is non-retryable");
});

test("backoff formula: calculates exponential delays", () => {
  assert.equal(BASE_BACKOFF_MS, 300);
  const backoff0 = BASE_BACKOFF_MS * 2 ** 0;
  const backoff1 = BASE_BACKOFF_MS * 2 ** 1;
  const backoff2 = BASE_BACKOFF_MS * 2 ** 2;

  assert.equal(backoff0, 300);
  assert.equal(backoff1, 600);
  assert.equal(backoff2, 1200);
});

test("askWithFallback: does not retry non-retryable 400 errors", async () => {
  let groqCalls = 0;
  providers.groq = async () => {
    groqCalls++;
    const err = new Error("Invalid model parameter");
    err.status = 400; // Non-retryable
    throw err;
  };

  mockProviderSuccess("gemini", "Gemini fallback succeeded");

  const result = await askWithFallback("Test prompt");

  // Groq should be called exactly ONCE (no retries on 400), then fallback to Gemini
  assert.equal(groqCalls, 1, "Non-retryable 400 error should not trigger retries");
  assert.equal(result.provider, "gemini");
  assert.equal(result.text, "Gemini fallback succeeded");
  assert.equal(result.attempts.length, 2); // 1 failed Groq attempt, 1 successful Gemini attempt
});

test("askWithFallback: retries retryable 500 error up to success", async () => {
  let groqCalls = 0;
  providers.groq = async () => {
    groqCalls++;
    if (groqCalls === 1) {
      const err = new Error("Transient backend glitch");
      err.status = 503; // Retryable
      throw err;
    }
    return {
      text: "Groq recovered on attempt 2",
      inputTokens: 10,
      outputTokens: 20,
      model: "openai/gpt-oss-120b",
    };
  };

  const result = await askWithFallback("Test prompt");

  assert.equal(groqCalls, 2);
  assert.equal(result.provider, "groq");
  assert.equal(result.text, "Groq recovered on attempt 2");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].success, false);
  assert.equal(result.attempts[1].success, true);
});
