// Token-usage counters live here so both the rate-limit middleware (reads,
// before the Groq call) and the chat route (writes, after a successful call)
// use the same Redis key format.
import { redis } from "../config/redis.js";

const DAY_IN_SECONDS = 60 * 60 * 24;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function tokenUsageKey(apiKeyId) {
  return `rl:tok:${apiKeyId}:${todayKey()}`;
}

// Returns how many tokens this API key has used so far today.
export async function getTokensUsedToday(apiKeyId) {
  const used = await redis.get(tokenUsageKey(apiKeyId));
  return used ? parseInt(used, 10) : 0;
}

// Adds a completed request's token count to today's running total.
export async function addTokenUsage(apiKeyId, tokens) {
  const key = tokenUsageKey(apiKeyId);
  await redis.incrby(key, tokens);
  await redis.expire(key, DAY_IN_SECONDS);
}
