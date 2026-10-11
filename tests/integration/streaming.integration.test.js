import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { createApiKey } from "../../src/services/apiKey.service.js";
import {
  mockProviderStream,
  resetAllMocks,
} from "../helpers/mockProviders.js";

let baseUrl;
let rawKey;

before(async () => {
  const env = await setupTestEnvironment();
  baseUrl = env.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
  resetAllMocks();
  const created = await createApiKey({ name: "stream-client" });
  rawKey = created.rawKey;
});

afterEach(async () => {
  await cleanTestDb();
  resetAllMocks();
});

after(async () => {
  await teardownTestEnvironment();
});

async function collectSSE(response) {
  const reader = response.body.getReader();
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
      const line = raw.replace(/^data: /, "").trim();
      if (line) {
        events.push(JSON.parse(line));
      }
    }
  }

  return events;
}

test("streaming: responds with Server-Sent Events delivering deltas and final done event", async () => {
  const streamChunks = ["Once ", "upon ", "a ", "time."];
  mockProviderStream("groq", streamChunks);

  const prompt = "Tell me a fairy tale";

  const res = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt, stream: true }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const events = await collectSSE(res);
  const deltas = events.filter((e) => e.delta !== undefined).map((e) => e.delta);
  const doneEvent = events.find((e) => e.done === true);

  assert.deepEqual(deltas, streamChunks);
  assert.ok(doneEvent, "Expected done event at end of stream");
  assert.equal(doneEvent.cached, false);
  assert.equal(doneEvent.provider, "groq");
  assert.ok(doneEvent.requestId);

  // Second streaming call with the exact same prompt should trigger a cache hit while streaming!
  const res2 = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({ prompt, stream: true }),
  });

  assert.equal(res2.status, 200);
  const events2 = await collectSSE(res2);
  const doneEvent2 = events2.find((e) => e.done === true);

  assert.ok(doneEvent2, "Expected done event on streaming cache hit");
  assert.equal(doneEvent2.cached, true, "Streaming response should be marked as cached");
  assert.equal(doneEvent2.cacheType, "exact");
  assert.equal(doneEvent2.costUsd, 0);
});
