import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { createApiKey } from "../../src/services/apiKey.service.js";
import { ensureSemanticIndex } from "../../src/services/semanticCache.service.js";
import {
  mockProviderSuccess,
  mockEmbeddingSuccess,
  createDeterministicVector,
  resetAllMocks,
} from "../helpers/mockProviders.js";

let baseUrl;

before(async () => {
  const env = await setupTestEnvironment();
  baseUrl = env.baseUrl;
  await ensureSemanticIndex();
});

beforeEach(async () => {
  await cleanTestDb();
  await ensureSemanticIndex();
  resetAllMocks();
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

test("semanticCache: opt-out key skips semantic cache even when similar entry exists", async () => {
  const { rawKey: optInKey } = await createApiKey({
    name: "opt-in-client",
    semanticCacheEnabled: true,
  });

  const { rawKey: optOutKey } = await createApiKey({
    name: "opt-out-client",
    semanticCacheEnabled: false,
  });

  const sharedVector = createDeterministicVector(42);
  mockEmbeddingSuccess(sharedVector);

  const calls = mockProviderSuccess("groq", "Machine learning is automated pattern recognition.");

  // 1. Opt-in key stores entry in semantic cache
  const res1 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${optInKey}`,
    },
    body: JSON.stringify({ prompt: "What is machine learning?" }),
  });
  assert.equal(res1.status, 200);
  assert.equal(calls.length, 1);

  // 2. Opt-out key sends paraphrase - should skip semantic cache!
  const res2 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${optOutKey}`,
    },
    body: JSON.stringify({ prompt: "Can you define machine learning?" }),
  });

  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-cache"), "MISS");
  const data2 = await res2.json();
  assert.equal(data2.cached, false);
  assert.equal(calls.length, 2, "Opt-out key must call provider rather than reading semantic cache");
});

test("semanticCache: opt-in key hits semantic cache for genuine paraphrase with cost 0", async () => {
  const { rawKey } = await createApiKey({
    name: "semantic-enabled-client",
    semanticCacheEnabled: true,
  });

  const sharedVector = createDeterministicVector(99);
  mockEmbeddingSuccess(sharedVector);

  const calls = mockProviderSuccess("groq", "Photosynthesis converts light into chemical energy.");

  // 1. First prompt
  const res1 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "How does photosynthesis work?" }),
  });
  assert.equal(res1.status, 200);
  assert.equal(calls.length, 1);

  // 2. Paraphrase prompt (same vector -> similarity 1.0, no entity diff -> accepted)
  const res2 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "Can you explain how photosynthesis works?" }),
  });

  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-cache"), "HIT-SEMANTIC");
  const data2 = await res2.json();
  assert.equal(data2.cached, true);
  assert.equal(data2.cacheType, "semantic");
  assert.equal(data2.costUsd, 0, "Semantic cache hit must cost $0");
  assert.equal(calls.length, 1, "Provider must NOT be called on semantic cache hit");
});

test("semanticCache: on/off antonym pair is rejected by guard and treated as a miss", async () => {
  const { rawKey } = await createApiKey({
    name: "antonym-test-client",
    semanticCacheEnabled: true,
  });

  const sharedVector = createDeterministicVector(123);
  mockEmbeddingSuccess(sharedVector);

  const calls = mockProviderSuccess("groq", "Toggle completed.");

  // 1. First prompt: "turn on"
  const res1 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "How do I turn on dark mode?" }),
  });
  assert.equal(res1.status, 200);
  assert.equal(calls.length, 1);

  // 2. Opposite prompt: "turn off" (shares vector, but antonym guard rejects on/off)
  const res2 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt: "How do I turn off dark mode?" }),
  });

  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-cache"), "MISS");
  const data2 = await res2.json();
  assert.equal(data2.cached, false);
  assert.match(data2.verifierResult, /antonym: (on\/off|off\/on)/);
  assert.equal(calls.length, 2, "Provider must be called when antonym guard rejects match");
});
