import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { setupTestEnvironment, cleanTestDb, teardownTestEnvironment } from "../helpers/testDb.js";
import { env } from "../../src/config/env.js";
import { ApiKey } from "../../src/models/ApiKey.js";

let baseUrl;

before(async () => {
  const testEnv = await setupTestEnvironment();
  baseUrl = testEnv.baseUrl;
});

beforeEach(async () => {
  await cleanTestDb();
});

afterEach(async () => {
  await cleanTestDb();
});

after(async () => {
  await teardownTestEnvironment();
});

test("admin: rejects endpoints under /v1/admin/* without x-admin-key", async () => {
  const res = await fetch(`${baseUrl}/v1/admin/overview`);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Missing or invalid x-admin-key header");
});

test("admin: rejects endpoints with incorrect x-admin-key", async () => {
  const res = await fetch(`${baseUrl}/v1/admin/overview`, {
    headers: { "x-admin-key": "wrong-secret-key" },
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Missing or invalid x-admin-key header");
});

test("admin: creates key, returns raw key once, and stores only SHA-256 hash in database", async () => {
  const res = await fetch(`${baseUrl}/v1/admin/keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": env.ADMIN_API_KEY,
    },
    body: JSON.stringify({
      name: "mobile-app-client",
      requestsPerMinute: 45,
      tokensPerDay: 75000,
      semanticCacheEnabled: true,
    }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();

  assert.ok(data.id, "Expected created key ID");
  assert.equal(data.name, "mobile-app-client");
  assert.ok(data.key.startsWith("gw_"), "Raw key must start with gw_ prefix");
  assert.equal(data.keyPrefix, data.key.slice(0, 8));
  assert.equal(data.requestsPerMinute, 45);
  assert.equal(data.tokensPerDay, 75000);
  assert.equal(data.semanticCacheEnabled, true);

  // Verify MongoDB document directly: only the hash should be stored!
  const storedDoc = await ApiKey.findById(data.id);
  assert.ok(storedDoc);
  const expectedHash = crypto.createHash("sha256").update(data.key).digest("hex");
  assert.equal(storedDoc.keyHash, expectedHash, "Stored hash must match SHA-256 of the raw key");
  assert.equal(storedDoc.key, undefined, "Raw key must never be stored in MongoDB");
});

test("admin: lists, patches, and deletes API keys", async () => {
  // 1. Create a key
  const createRes = await fetch(`${baseUrl}/v1/admin/keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": env.ADMIN_API_KEY,
    },
    body: JSON.stringify({ name: "to-be-patched" }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  // 2. List keys
  const listRes = await fetch(`${baseUrl}/v1/admin/keys`, {
    headers: { "x-admin-key": env.ADMIN_API_KEY },
  });
  assert.equal(listRes.status, 200);
  const keysList = await listRes.json();
  assert.ok(keysList.some((k) => k.id === created.id));

  // 3. Patch key (toggle isActive to false)
  const patchRes = await fetch(`${baseUrl}/v1/admin/keys/${created.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": env.ADMIN_API_KEY,
    },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();
  assert.equal(patched.isActive, false);

  // 4. Delete key
  const deleteRes = await fetch(`${baseUrl}/v1/admin/keys/${created.id}`, {
    method: "DELETE",
    headers: { "x-admin-key": env.ADMIN_API_KEY },
  });
  assert.equal(deleteRes.status, 200);

  const foundAfterDelete = await ApiKey.findById(created.id);
  assert.equal(foundAfterDelete, null);
});

test("admin: GET /v1/admin/overview returns aggregated KPI summary", async () => {
  const res = await fetch(`${baseUrl}/v1/admin/overview?range=24h`, {
    headers: { "x-admin-key": env.ADMIN_API_KEY },
  });

  assert.equal(res.status, 200);
  const overview = await res.json();
  assert.equal(overview.range, "24h");
  assert.equal(typeof overview.totalRequests, "number");
  assert.equal(typeof overview.successRate, "number");
  assert.equal(typeof overview.totalCostUsd, "number");
});
