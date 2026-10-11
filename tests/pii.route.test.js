// Integration tests for the PII redaction pipeline as wired into POST
// /v1/chat - mask mode, block mode, cache/log leakage, and the streaming
// split-placeholder case. Needs a real reachable Mongo (MONGO_URI) and
// Redis (REDIS_URL) - same as the rest of this app - but the actual LLM
// providers are swapped out for in-process mocks (see mockGroq()/
// mockGroqStream() below) so these tests never make a real network call to
// Groq/Gemini and never depend on model output being predictable.
//
// Provider mocking works by mutating the `providers`/`streamingProviders`
// registry objects in place (see src/services/providers/index.js) - they're
// plain exported objects, and router.service.js imports the SAME object
// reference, so overwriting `providers.groq` here is visible to it without
// needing any extra mocking library.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connectDB } from "../src/config/db.js";
import { redis, connectRedis } from "../src/config/redis.js";
import { env } from "../src/config/env.js";
import app from "../src/app.js";
import { ApiKey } from "../src/models/ApiKey.js";
import { RequestLog } from "../src/models/RequestLog.js";
import { createApiKey } from "../src/services/apiKey.service.js";
import { providers, streamingProviders } from "../src/services/providers/index.js";
import { buildCacheKey } from "../src/services/cache.service.js";
import { getPrimaryModel } from "../src/services/router.service.js";

let baseUrl;
let server;
const createdApiKeyIds = [];
const createdRequestIds = [];
// Redis's exact-match cache is real and persists across test runs (TTL is
// a full day) - a fixed prompt string would hit a PREVIOUS run's cached
// answer instead of exercising the mock provider. Every test prompt below
// includes this nonce so each run gets its own fresh cache key.
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Swaps the primary provider (groq, per PROVIDER_ORDER) for a mock that
// records the exact prompt it was called with and returns canned text.
function mockGroq(responseText, { model = env.GROQ_MODEL } = {}) {
  const calls = [];
  providers.groq = async (prompt) => {
    calls.push(prompt);
    return { text: responseText, inputTokens: 3, outputTokens: 3, model };
  };
  return calls;
}

function mockGroqAlwaysFails(status = 400) {
  const calls = [];
  const fn = async (prompt) => {
    calls.push(prompt);
    const error = new Error("mock provider failure");
    error.status = status; // 400 = not retryable, keeps the test fast
    throw error;
  };
  providers.groq = fn;
  providers.gemini = fn; // PROVIDER_ORDER is "groq,gemini" - both must fail for askWithFallback to give up
  return calls;
}

// Streaming mock whose deltas are controlled by the caller, so a test can
// split a placeholder like "[EMAIL_1]" across two separate onDelta calls.
function mockGroqStream(deltas, { model = env.GROQ_MODEL } = {}) {
  const calls = [];
  streamingProviders.groq = async (prompt, { onDelta }) => {
    calls.push(prompt);
    let text = "";
    for (const part of deltas) {
      onDelta(part);
      text += part;
    }
    return { text, inputTokens: 3, outputTokens: 3, model };
  };
  return calls;
}

async function createTestKey(piiMode, extra = {}) {
  const { key, rawKey } = await createApiKey({
    name: `pii-test-${piiMode}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    piiMode,
    ...extra,
  });
  createdApiKeyIds.push(key._id);
  return rawKey;
}

async function postChat(rawKey, body) {
  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json?.requestId) createdRequestIds.push(json.requestId);
  return { status: res.status, headers: res.headers, json };
}

// Reads a Server-Sent Events response into a flat list of parsed events.
async function collectSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = raw.replace(/^data: /, "");
      if (line.trim()) events.push(JSON.parse(line));
    }
  }
  return events;
}

async function postChatStream(rawKey, body) {
  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify({ ...body, stream: true }),
  });
  const events = await collectSSE(res);
  const doneEvent = events.find((e) => e.done);
  if (doneEvent?.requestId) createdRequestIds.push(doneEvent.requestId);
  return { status: res.status, headers: res.headers, events, doneEvent };
}

before(async () => {
  await connectDB();
  await connectRedis();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (createdRequestIds.length > 0) {
    await RequestLog.deleteMany({ _id: { $in: createdRequestIds } });
  }
  if (createdApiKeyIds.length > 0) {
    await ApiKey.deleteMany({ _id: { $in: createdApiKeyIds } });
  }
  await new Promise((resolve) => server.close(resolve));
  await mongooseDisconnect();
  await redis.quit();
});

async function mongooseDisconnect() {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
}

// --- Mask mode -------------------------------------------------------------

test("mask mode: the provider only ever sees masked text, and the client gets real values back", async () => {
  const rawKey = await createTestKey("mask");
  const calls = mockGroq("Sure, your email jane.doe@example.com is noted.");

  const prompt = `My email is jane.doe@example.com, can you confirm it? (ref ${nonce}-1)`;
  const { status, json } = await postChat(rawKey, { prompt });

  assert.equal(status, 200);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("jane.doe@example.com"), "provider must never see the real email");
  assert.match(calls[0], /\[EMAIL_1\]/);

  // The provider's mock answer also echoes the placeholder back (as a real
  // model would if it repeats the masked prompt) - the client-facing
  // response must have the REAL value restored.
  assert.ok(json.response.includes("jane.doe@example.com"), "client should see the real email restored");
  assert.ok(!json.response.includes("[EMAIL_1]"), "client should never see a raw placeholder");
  assert.equal(json.piiRedacted >= 1, true);
  assert.deepEqual(json.piiTypes, ["EMAIL"]);
});

// --- Block mode --------------------------------------------------------

test("block mode: returns 422 and never calls the provider or touches the cache", async () => {
  const rawKey = await createTestKey("block");
  const calls = mockGroq("should never be called");

  const prompt = `My card number is 4111 1111 1111 1111, please charge it (ref ${nonce}-2)`;
  const maskedPrompt = prompt.replace("4111 1111 1111 1111", "[CARD_1]");
  const cacheKey = buildCacheKey(getPrimaryModel(), maskedPrompt);
  const { status, json } = await postChat(rawKey, { prompt });

  assert.equal(status, 422);
  assert.equal(calls.length, 0, "provider must never be called in block mode");
  assert.deepEqual(json.types, ["CARD"]);
  assert.ok(!JSON.stringify(json).includes("4111 1111 1111 1111"), "the real card number must never appear in the response");

  // Nothing should have been cached for this prompt under any form of it.
  const rawCached = await redis.get(buildCacheKey(getPrimaryModel(), prompt));
  assert.equal(rawCached, null);
  assert.equal(await redis.exists(cacheKey), 0);

  const log = await RequestLog.findById(json.requestId);
  assert.equal(log.status, "blocked");
  assert.ok(!log.prompt.includes("4111 1111 1111 1111"));
});

// --- Cache and RequestLog never contain real values -------------------

test("mask mode: neither the Redis cache entry nor the RequestLog ever stores the real value", async () => {
  const rawKey = await createTestKey("mask");
  mockGroq("Noted - your PAN is ABCDE1234F.");

  const prompt = `Please remember my PAN is ABCDE1234F (ref ${nonce}-3)`;
  const { status, json } = await postChat(rawKey, { prompt });
  assert.equal(status, 200);

  const maskedPrompt = prompt.replace("ABCDE1234F", "[PAN_1]");
  const cacheKey = buildCacheKey(getPrimaryModel(), maskedPrompt);
  const cachedRaw = await redis.get(cacheKey);
  assert.ok(cachedRaw, "setup: the answer should have been cached");
  assert.ok(!cachedRaw.includes("ABCDE1234F"), "cache entry must never contain the real PAN");

  const log = await RequestLog.findById(json.requestId);
  assert.ok(!log.prompt.includes("ABCDE1234F"));
  assert.ok(!log.response.includes("ABCDE1234F"));
  assert.deepEqual(log.piiTypes, ["PAN"]);
});

// --- Provider error never leaks the raw prompt --------------------------

test("a provider error logs the MASKED prompt, never the real value", async () => {
  const rawKey = await createTestKey("mask");
  mockGroqAlwaysFails(400);

  const prompt = `My email for support is jane.doe@example.com, please help (ref ${nonce}-4)`;
  const { status, json } = await postChat(rawKey, { prompt });

  assert.equal(status, 502);
  assert.ok(!JSON.stringify(json).includes("jane.doe@example.com"), "error response must never leak the real email");

  const log = await RequestLog.findById(json.requestId);
  assert.equal(log.status, "error");
  assert.ok(!log.prompt.includes("jane.doe@example.com"), "RequestLog.prompt must never contain the real email");
  assert.match(log.prompt, /\[EMAIL_1\]/);
});

// --- Streaming: placeholder split across chunk boundaries --------------

test("streaming: a placeholder split across two chunks is restored correctly for the client", async () => {
  const rawKey = await createTestKey("mask");
  // The "model" echoes the prompt's placeholder back, split mid-token
  // across two deltas - exactly the case createStreamRestorer() exists for.
  mockGroqStream(["Sure, I noted [EMA", "IL_1] as your contact email."]);

  const prompt = `My email is jane.doe@example.com, please note it down (ref ${nonce}-5)`;
  const { status, events, doneEvent } = await postChatStream(rawKey, { prompt });

  assert.equal(status, 200);
  const deltas = events.filter((e) => e.delta !== undefined).map((e) => e.delta);
  const fullText = deltas.join("");

  assert.ok(fullText.includes("jane.doe@example.com"), "the restored email should appear in the streamed text");
  assert.ok(!fullText.includes("[EMAIL_1]"), "no raw placeholder should reach the client");
  assert.ok(
    !deltas.some((d) => d.includes("[EMA") && !d.includes("jane.doe@example.com")),
    "no delta should ever contain half of a placeholder"
  );
  assert.ok(doneEvent, "setup: should have received a done event");

  const log = await RequestLog.findById(doneEvent.requestId);
  assert.ok(!log.response.includes("jane.doe@example.com"), "the stored log must still hold the masked answer");
});
