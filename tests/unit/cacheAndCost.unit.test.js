import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePrompt, buildCacheKey } from "../../src/services/cache.service.js";
import { calculateCost } from "../../src/services/cost.service.js";

test("normalizePrompt: trims leading and trailing whitespace", () => {
  assert.equal(normalizePrompt("  hello world  "), "hello world");
});

test("normalizePrompt: collapses multiple consecutive spaces, tabs, and newlines into single spaces", () => {
  assert.equal(normalizePrompt("what   is   \n\n\t node.js?"), "what is node.js?");
});

test("normalizePrompt: preserves original letter casing", () => {
  // Case sensitive: Paris (capital) != paris
  assert.equal(normalizePrompt("What is Paris?"), "What is Paris?");
  assert.notEqual(normalizePrompt("What is Paris?"), "what is paris?");
});

test("buildCacheKey: produces deterministic SHA-256 hash formatted as cache:exact:<hex>", () => {
  const model = "openai/gpt-oss-120b";
  const prompt = "Explain recursion";

  const key1 = buildCacheKey(model, prompt);
  const key2 = buildCacheKey(model, prompt);

  assert.equal(key1, key2);
  assert.match(key1, /^cache:exact:[a-f0-9]{64}$/);
});

test("buildCacheKey: distinguishes between different models for the exact same prompt", () => {
  const prompt = "Explain recursion";
  const keyGroq = buildCacheKey("openai/gpt-oss-120b", prompt);
  const keyGemini = buildCacheKey("gemini-3.5-flash-lite", prompt);

  assert.notEqual(keyGroq, keyGemini);
});

test("buildCacheKey: treats whitespace-variant prompts as the same cache key", () => {
  const key1 = buildCacheKey("model-a", "how to write a loop");
  const key2 = buildCacheKey("model-a", "  how   to write  \n a loop ");

  assert.equal(key1, key2);
});

test("calculateCost: computes correct USD price for configured models", () => {
  // Pricing configured in pricing.js:
  // openai/gpt-oss-120b: input: 0.15/1M, output: 0.75/1M
  // 1,000,000 input tokens = $0.15; 1,000,000 output tokens = $0.75 => $0.90
  const costFullMillion = calculateCost("openai/gpt-oss-120b", 1_000_000, 1_000_000);
  assert.equal(Math.round(costFullMillion * 100) / 100, 0.90);

  // 1,000 input tokens + 2,000 output tokens:
  // (1000 / 1e6) * 0.15 = 0.00015
  // (2000 / 1e6) * 0.75 = 0.00150
  // total = 0.00165
  const costSmall = calculateCost("openai/gpt-oss-120b", 1000, 2000);
  assert.equal(costSmall, 0.00165);

  // gemini-3.5-flash-lite: input: 0.10/1M, output: 0.40/1M
  const geminiCost = calculateCost("gemini-3.5-flash-lite", 1_000_000, 1_000_000);
  assert.equal(Math.round(geminiCost * 100) / 100, 0.50);
});

test("calculateCost: returns $0 for models suffixed with :free without warning", () => {
  const cost = calculateCost("meta-llama/llama-3.1-8b-instruct:free", 5000, 5000);
  assert.equal(cost, 0);
});

test("calculateCost: returns $0 for unconfigured models", () => {
  const cost = calculateCost("some-nonexistent-model", 1000, 1000);
  assert.equal(cost, 0);
});
