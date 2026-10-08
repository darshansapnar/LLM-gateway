// Exact-match response caching: identical (model + prompt) pairs skip the
// provider call entirely and reuse a previous answer.
import crypto from "crypto";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";

// Trims the prompt and collapses repeated whitespace into single spaces.
// We deliberately do NOT lowercase - casing can change meaning (e.g. "Paris" vs "paris").
export function normalizePrompt(prompt) {
  return prompt.trim().replace(/\s+/g, " ");
}

// Builds a cache key from the model name and normalized prompt, so the same
// wording cached under one model doesn't match a request for another model.
export function buildCacheKey(model, prompt) {
  const normalized = normalizePrompt(prompt);
  const hash = crypto.createHash("sha256").update(model + normalized).digest("hex");
  return `cache:exact:${hash}`;
}

export async function getCached(key) {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function setCached(key, data) {
  await redis.set(key, JSON.stringify(data), "EX", env.CACHE_TTL_SECONDS);
}

// Three separate counters so stats can tell an exact match apart from a
// semantic one, instead of lumping all "cache worked" cases together.
export async function recordExactHit() {
  await redis.incr("cache:stats:hits:exact");
}

export async function recordSemanticHit() {
  await redis.incr("cache:stats:hits:semantic");
}

export async function recordMiss() {
  await redis.incr("cache:stats:misses");
}

// A request that reached the semantic-cache-eligible point (exact cache
// missed) but didn't use it specifically because this API key hasn't opted
// in - distinct from the feature being off globally, or skipped for a
// request with conversation history.
export async function recordSemanticSkippedOptOut() {
  await redis.incr("cache:stats:semantic:skipped:optout");
}

export async function getCacheStats() {
  const [exactHits, semanticHits, misses, semanticSkippedOptOut] = await redis.mget(
    "cache:stats:hits:exact",
    "cache:stats:hits:semantic",
    "cache:stats:misses",
    "cache:stats:semantic:skipped:optout"
  );
  const exactHitsNum = Number(exactHits) || 0;
  const semanticHitsNum = Number(semanticHits) || 0;
  const missesNum = Number(misses) || 0;
  const total = exactHitsNum + semanticHitsNum + missesNum;
  const hitRate = total === 0 ? 0 : (exactHitsNum + semanticHitsNum) / total;

  return {
    exactHits: exactHitsNum,
    semanticHits: semanticHitsNum,
    misses: missesNum,
    hitRate,
    semanticSkippedOptOut: Number(semanticSkippedOptOut) || 0,
  };
}
