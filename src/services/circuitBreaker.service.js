// Per-provider circuit breaker backed by Redis.
//
// States:
//   CLOSED     - normal operation, every request is allowed through.
//   OPEN       - the provider is skipped entirely for OPEN_DURATION_MS,
//                because it just failed FAILURE_THRESHOLD times in a row.
//   HALF_OPEN  - once OPEN_DURATION_MS has passed, exactly one request is
//                let through as a test: success closes the circuit again,
//                failure sends it straight back to OPEN.
import { redis } from "../config/redis.js";

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 30000;

function failuresKey(provider) {
  return `cb:${provider}:failures`;
}

function openedAtKey(provider) {
  return `cb:${provider}:openedAt`;
}

function halfOpenLockKey(provider) {
  return `cb:${provider}:halfOpenLock`;
}

// Returns "CLOSED", "OPEN", or "HALF_OPEN" for this provider right now.
export async function getState(provider) {
  const openedAt = await redis.get(openedAtKey(provider));
  if (!openedAt) {
    return "CLOSED";
  }

  const elapsed = Date.now() - Number(openedAt);
  return elapsed < OPEN_DURATION_MS ? "OPEN" : "HALF_OPEN";
}

// Call before attempting a provider. Returns false if the breaker says to
// skip it (fully OPEN, or HALF_OPEN but another request already claimed
// the one test slot).
export async function allowRequest(provider) {
  const state = await getState(provider);

  if (state === "CLOSED") {
    return true;
  }

  if (state === "OPEN") {
    return false;
  }

  // HALF_OPEN - only the first caller to grab this lock gets to be the test.
  const acquiredLock = await redis.set(halfOpenLockKey(provider), "1", "EX", 30, "NX");
  return acquiredLock === "OK";
}

// Call after a provider call succeeds: fully resets the breaker.
export async function recordSuccess(provider) {
  await redis.del(failuresKey(provider));
  await redis.del(openedAtKey(provider));
  await redis.del(halfOpenLockKey(provider));
}

// Call after a provider call (including its retries) ultimately fails.
export async function recordFailure(provider) {
  const state = await getState(provider);

  if (state === "HALF_OPEN") {
    // The test request failed - go straight back to OPEN.
    await redis.set(openedAtKey(provider), Date.now());
    return;
  }

  const failures = await redis.incr(failuresKey(provider));
  if (failures >= FAILURE_THRESHOLD) {
    await redis.set(openedAtKey(provider), Date.now());
  }
}
