import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { redis } from "../../src/config/redis.js";
import { env } from "../../src/config/env.js";
import {
  antonymGuard,
  hasEntityDifference,
  llmJudge,
  verifyCandidate,
} from "../../src/services/cacheVerifier.service.js";
import {
  mockProviderSuccess,
  mockProviderTimeout,
  resetAllMocks,
} from "../helpers/mockProviders.js";

beforeEach(() => {
  resetAllMocks();
});

afterEach(() => {
  resetAllMocks();
});

after(async () => {
  await redis.quit();
});

test("antonymGuard: rejects known antonym pairs from dictionary", () => {
  const result1 = antonymGuard("How do I turn on dark mode?", "How do I turn off dark mode?");
  assert.equal(result1.accepted, false);
  assert.match(result1.reason, /antonym: on\/off/);

  const result2 = antonymGuard("Please start the container", "Please stop the container");
  assert.equal(result2.accepted, false);
  assert.match(result2.reason, /antonym: start\/stop/);
});

test("antonymGuard: rejects automatically detected un- and dis- prefix pairs", () => {
  // un- prefix
  const result1 = antonymGuard("How do I lock a file?", "How do I unlock a file?");
  assert.equal(result1.accepted, false);
  assert.match(result1.reason, /antonym: lock\/unlock/);

  // dis- prefix
  const result2 = antonymGuard("Please connect to the database", "Please disconnect to the database");
  assert.equal(result2.accepted, false);
  assert.match(result2.reason, /antonym: connect\/disconnect/);

  const result3 = antonymGuard("Enable logging in config", "Disable logging in config");
  assert.equal(result3.accepted, false);
  assert.match(result3.reason, /antonym: enable\/disable/);
});

test("antonymGuard: rejects prompts mentioning different numbers", () => {
  const result = antonymGuard("Show me the top 5 restaurants", "Show me the top 10 restaurants");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /different numbers/);
});

test("antonymGuard: accepts prompts with identical numbers or no number conflicts", () => {
  const result1 = antonymGuard("Page 1 of report", "Screen 1 of report");
  assert.equal(result1.accepted, true);

  const result2 = antonymGuard("What is quantum computing?", "Explain quantum computing simply");
  assert.equal(result2.accepted, true);
});

test("hasEntityDifference: flags different capitalized words (proper nouns)", () => {
  // France vs Spain differs on capitalized words
  assert.equal(hasEntityDifference("What is the capital of France?", "What is the capital of Spain?"), true);
});

test("hasEntityDifference: flags recognized programming languages and tech terms", () => {
  // python vs rust (lowercase)
  assert.equal(hasEntityDifference("How do I reverse a list in python?", "How do I reverse a list in rust?"), true);

  // react vs vue
  assert.equal(hasEntityDifference("Create a component in React", "Create a component in Vue"), true);
});

test("hasEntityDifference: ignores capitalization of the first word", () => {
  // "What" vs "Can" at position 0 should not count as an entity difference
  assert.equal(hasEntityDifference("What is artificial intelligence?", "Can you explain artificial intelligence?"), false);
});

test("verifyCandidate: skips LLM judge when similarity >= 0.97 and no entity difference", async () => {
  const calls = mockProviderSuccess("groq", "YES");

  const promptA = "What is artificial intelligence?";
  const promptB = "Explain artificial intelligence";
  const result = await verifyCandidate(promptA, promptB, 0.98);

  assert.equal(result.accepted, true);
  assert.equal(result.outcome, "accepted_high_similarity");
  assert.equal(result.judgeUsed, false);
  assert.equal(calls.length, 0, "Judge must be skipped when similarity >= 0.97 and no entity difference");
});

test("verifyCandidate: does not skip judge if entity difference exists, even above 0.97", async () => {
  const calls = mockProviderSuccess("groq", "NO");

  const nonce = Date.now().toString(36);
  const promptA = `How do I setup React in app-${nonce}?`;
  const promptB = `How do I setup Vue in app-${nonce}?`;
  const result = await verifyCandidate(promptA, promptB, 0.99);

  // Even with 0.99 similarity, React vs Vue triggers entity check -> routes to judge
  assert.equal(calls.length, 1);
  assert.equal(result.judgeUsed, true);
  assert.equal(result.outcome, "rejected_by_judge");
});

test("llmJudge: defaults to NO on timeout or failure", async () => {
  const origTimeout = env.JUDGE_TIMEOUT_MS;
  env.JUDGE_TIMEOUT_MS = 50;
  try {
    mockProviderTimeout("groq", 1000); // Exceeds 50ms
    const result = await llmJudge("Is water wet?", "Does water have liquid properties?");
    assert.equal(result.accepted, false);
    assert.match(result.reason, /defaulting to NO/);
    assert.equal(result.costUsd, 0);
  } finally {
    env.JUDGE_TIMEOUT_MS = origTimeout;
  }
});

test("llmJudge: accepts when LLM answers YES", async () => {
  mockProviderSuccess("groq", "YES");

  const result = await llmJudge("What is node.js?", "Define node.js");
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "accepted");
});
