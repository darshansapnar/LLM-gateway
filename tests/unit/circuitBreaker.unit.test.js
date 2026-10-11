import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { redis, connectRedis } from "../../src/config/redis.js";
import {
  getState,
  allowRequest,
  recordSuccess,
  recordFailure,
} from "../../src/services/circuitBreaker.service.js";

const TEST_PROVIDER = "unit-test-provider";

// Uses the real Redis connection (DB 0, same as everything else in test
// mode - RediSearch only works on DB 0, so no test may select a different
// one). Isolation from other tests comes from TEST_PROVIDER being a name
// no other test/circuit touches, plus resetting it before/after each test.
before(async () => {
  await connectRedis();
});

beforeEach(async () => {
  await recordSuccess(TEST_PROVIDER);
});

after(async () => {
  await recordSuccess(TEST_PROVIDER);
  await redis.quit();
});

test("circuitBreaker: starts in CLOSED state and allows requests", async () => {
  const state = await getState(TEST_PROVIDER);
  assert.equal(state, "CLOSED");

  const allowed = await allowRequest(TEST_PROVIDER);
  assert.equal(allowed, true);
});

test("circuitBreaker: transitions to OPEN after 3 consecutive failures", async () => {
  // Failure 1
  await recordFailure(TEST_PROVIDER);
  assert.equal(await getState(TEST_PROVIDER), "CLOSED");
  assert.equal(await allowRequest(TEST_PROVIDER), true);

  // Failure 2
  await recordFailure(TEST_PROVIDER);
  assert.equal(await getState(TEST_PROVIDER), "CLOSED");
  assert.equal(await allowRequest(TEST_PROVIDER), true);

  // Failure 3 -> trips the breaker!
  await recordFailure(TEST_PROVIDER);
  assert.equal(await getState(TEST_PROVIDER), "OPEN");

  // While OPEN, requests are blocked
  const allowed = await allowRequest(TEST_PROVIDER);
  assert.equal(allowed, false);
});

test("circuitBreaker: transitions to HALF_OPEN after cooldown period elapses", async () => {
  // Trip the breaker to OPEN
  await recordFailure(TEST_PROVIDER);
  await recordFailure(TEST_PROVIDER);
  await recordFailure(TEST_PROVIDER);
  assert.equal(await getState(TEST_PROVIDER), "OPEN");

  // Fast-forward cooldown by manipulating openedAt timestamp in Redis (31 seconds in the past)
  const openedAtKey = `cb:${TEST_PROVIDER}:openedAt`;
  await redis.set(openedAtKey, Date.now() - 31000);

  // State should now be HALF_OPEN
  const state = await getState(TEST_PROVIDER);
  assert.equal(state, "HALF_OPEN");

  // Exactly one test request is allowed
  const allowedFirst = await allowRequest(TEST_PROVIDER);
  assert.equal(allowedFirst, true, "First request in HALF_OPEN claims test slot");

  // Second concurrent request should be rejected (lock is held)
  const allowedSecond = await allowRequest(TEST_PROVIDER);
  assert.equal(allowedSecond, false, "Second request in HALF_OPEN is blocked while test request is running");
});

test("circuitBreaker: failure during HALF_OPEN returns straight to OPEN", async () => {
  // Set breaker into HALF_OPEN state
  await redis.set(`cb:${TEST_PROVIDER}:openedAt`, Date.now() - 31000);
  assert.equal(await getState(TEST_PROVIDER), "HALF_OPEN");

  // The test request fails
  await recordFailure(TEST_PROVIDER);

  // Breaker must go back to OPEN immediately
  const state = await getState(TEST_PROVIDER);
  assert.equal(state, "OPEN");
  assert.equal(await allowRequest(TEST_PROVIDER), false);
});

test("circuitBreaker: success resets circuit breaker back to CLOSED", async () => {
  // Set to OPEN
  await recordFailure(TEST_PROVIDER);
  await recordFailure(TEST_PROVIDER);
  await recordFailure(TEST_PROVIDER);
  assert.equal(await getState(TEST_PROVIDER), "OPEN");

  // Provider call succeeds
  await recordSuccess(TEST_PROVIDER);

  assert.equal(await getState(TEST_PROVIDER), "CLOSED");
  assert.equal(await allowRequest(TEST_PROVIDER), true);
});
