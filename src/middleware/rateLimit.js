// Fixed-window rate limiting backed by Redis: one window for requests/minute,
// one window for tokens/day. Runs after auth (needs req.apiKey) and before
// the Groq call. addTokenUsage() is called separately, from the chat route,
// once the real token count from Groq's response is known.
import { redis } from "../config/redis.js";
import { getTokensUsedToday } from "../services/rateLimit.service.js";

export async function rateLimit(req, res, next) {
  const apiKey = req.apiKey;
  const { requestsPerMinute, tokensPerDay } = apiKey;

  // --- requests-per-minute window ---
  const currentMinute = Math.floor(Date.now() / 60000);
  const reqKey = `rl:req:${apiKey._id}:${currentMinute}`;

  const requestCount = await redis.incr(reqKey);
  if (requestCount === 1) {
    await redis.expire(reqKey, 60);
  }

  const remaining = Math.max(0, requestsPerMinute - requestCount);
  res.set("X-RateLimit-Limit", String(requestsPerMinute));
  res.set("X-RateLimit-Remaining", String(remaining));

  if (requestCount > requestsPerMinute) {
    const secondsIntoWindow = Math.floor(Date.now() / 1000) % 60;
    res.set("Retry-After", String(60 - secondsIntoWindow));
    return res.status(429).json({
      error: `Rate limit exceeded: max ${requestsPerMinute} requests per minute`,
    });
  }

  // --- tokens-per-day window ---
  const tokensUsed = await getTokensUsedToday(apiKey._id);

  if (tokensUsed >= tokensPerDay) {
    const now = new Date();
    const midnightUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
    res.set("Retry-After", String(Math.ceil((midnightUTC - now) / 1000)));
    return res.status(429).json({
      error: `Daily token limit exceeded: max ${tokensPerDay} tokens per day`,
    });
  }

  next();
}
