// Helper services for public Demo Mode:
// - Anonymous visitor ID generation & cookie assignment (httpOnly, 24h)
// - SHA-256 IP hashing (raw IP is never stored)
// - Demo API key resolution
// - Hourly per-IP rate limiting & daily budget tracking
import crypto from "crypto";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { ApiKey } from "../models/ApiKey.js";
import { PII_TYPES } from "../config/piiTypes.js";

// Generates a one-way SHA-256 hash of the client's IP.
// The raw IP is never logged or stored.
export function hashIp(ip) {
  if (!ip) return "unknown";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

// Retrieves or creates the anonymous visitor ID stored in an httpOnly cookie.
// Cookie expires after 24 hours.
export function getOrCreateVisitorId(req, res) {
  let visitorId = req.cookies?.visitorId;

  if (!visitorId || typeof visitorId !== "string" || visitorId.trim().length < 8) {
    visitorId = crypto.randomUUID();
    res.cookie("visitorId", visitorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  return visitorId;
}

// Retrieves or creates the internal gateway ApiKey document associated with DEMO_API_KEY.
// Ensures piiMode is always "mask" so demo requests can never leak sensitive info.
export async function getOrCreateDemoApiKey() {
  const rawKey = env.DEMO_API_KEY || "gw_demo_default_key";
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  let apiKey = await ApiKey.findOne({ keyHash });
  if (!apiKey) {
    apiKey = await ApiKey.create({
      name: "Public Demo Key",
      keyHash,
      keyPrefix: rawKey.slice(0, 8),
      requestsPerMinute: 1000,
      tokensPerDay: 10000000,
      isActive: true,
      semanticCacheEnabled: true,
      piiMode: "mask",
      piiTypes: PII_TYPES,
      restoreInResponse: true,
    });
  }

  return apiKey;
}

// Checks and increments demo rate limits in Redis:
// 1. Daily request budget (across all demo visitors)
// 2. Hourly per-IP limit (keyed by hashed IP)
// Returns { allowed: true, visitorId, clientIpHash, remaining } or sends 429 response.
export async function enforceDemoRateLimits(req, res) {
  const visitorId = getOrCreateVisitorId(req, res);
  const clientIpHash = hashIp(req.ip);

  // --- 1. Global Daily Request Budget ---
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const dailyKey = `rl:demo:daily:${dateStr}`;

  const dailyCount = await redis.incr(dailyKey);
  if (dailyCount === 1) {
    await redis.expire(dailyKey, 86400);
  }

  const dailyBudget = env.DEMO_DAILY_REQUEST_BUDGET;
  if (dailyCount > dailyBudget) {
    const midnightUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
    const retryAfter = Math.ceil((midnightUTC - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Demo limit reached for today. Please come back tomorrow or use your own API key.",
      retryAfter,
    });
    return { allowed: false };
  }

  // --- 2. Hourly Per-IP Rate Limit ---
  const currentHour = Math.floor(Date.now() / 3600000);
  const ipKey = `rl:demo:ip:${clientIpHash}:${currentHour}`;

  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) {
    await redis.expire(ipKey, 3600);
  }

  const hourlyLimit = env.DEMO_REQUESTS_PER_HOUR_PER_IP;
  const remaining = Math.max(0, hourlyLimit - ipCount);
  res.set("X-RateLimit-Limit", String(hourlyLimit));
  res.set("X-RateLimit-Remaining", String(remaining));

  if (ipCount > hourlyLimit) {
    const secondsIntoHour = Math.floor(Date.now() / 1000) % 3600;
    const retryAfter = 3600 - secondsIntoHour;
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: `Rate limit exceeded: demo allows max ${hourlyLimit} requests per hour per IP. Please try again later.`,
      retryAfter,
    });
    return { allowed: false };
  }

  return {
    allowed: true,
    visitorId,
    clientIpHash,
    remaining,
  };
}
