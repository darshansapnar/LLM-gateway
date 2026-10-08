// Admin-only routes for the dashboard (Stage 7): everything here requires
// the "x-admin-key" header (see src/middleware/adminAuth.js) - applied once
// below with router.use(), so every route in this file is protected.
import { Router } from "express";
import { RequestLog } from "../models/RequestLog.js";
import { ApiKey } from "../models/ApiKey.js";
import { env } from "../config/env.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { getCacheStats } from "../services/cache.service.js";
import { getState as getCircuitState } from "../services/circuitBreaker.service.js";
import { getTokensUsedToday } from "../services/rateLimit.service.js";
import { createApiKey } from "../services/apiKey.service.js";

const router = Router();
router.use(adminAuth);

const RANGE_MS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

// Turns ?range=1h|24h|7d into a Date to filter createdAt >= since.
// Anything unrecognized falls back to 24h.
function rangeToSince(range) {
  const ms = RANGE_MS[range] || RANGE_MS["24h"];
  return new Date(Date.now() - ms);
}

// GET /v1/admin/overview?range=1h|24h|7d - the dashboard's top-level KPI cards.
router.get("/v1/admin/overview", async (req, res) => {
  const range = RANGE_MS[req.query.range] ? req.query.range : "24h";
  const since = rangeToSince(range);

  const [totals] = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        successCount: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
        totalCostUsd: { $sum: "$costUsd" },
        costSavedUsd: { $sum: "$costSavedUsd" },
        exactHits: { $sum: { $cond: [{ $eq: ["$cacheType", "exact"] }, 1, 0] } },
        semanticHits: { $sum: { $cond: [{ $eq: ["$cacheType", "semantic"] }, 1, 0] } },
        avgLatencyMs: { $avg: "$latencyMs" },
        fallbackCount: { $sum: { $cond: ["$fallbackUsed", 1, 0] } },
        judgeCalls: { $sum: { $cond: ["$judgeUsed", 1, 0] } },
        judgeCostUsd: { $sum: "$judgeCostUsd" },
      },
    },
  ]);

  // Separate aggregation: avg time-to-first-token only makes sense over
  // streaming requests that actually recorded one.
  const [streaming] = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: since }, stream: true, ttftMs: { $ne: null } } },
    { $group: { _id: null, avgTtftMs: { $avg: "$ttftMs" } } },
  ]);

  const t = totals || {};
  const totalRequests = t.totalRequests || 0;

  res.json({
    range,
    totalRequests,
    successRate: totalRequests ? (t.successCount || 0) / totalRequests : 0,
    totalCostUsd: t.totalCostUsd || 0,
    costSavedUsd: t.costSavedUsd || 0,
    cacheHitRate: totalRequests ? ((t.exactHits || 0) + (t.semanticHits || 0)) / totalRequests : 0,
    exactHitRate: totalRequests ? (t.exactHits || 0) / totalRequests : 0,
    semanticHitRate: totalRequests ? (t.semanticHits || 0) / totalRequests : 0,
    avgLatencyMs: t.avgLatencyMs ? Math.round(t.avgLatencyMs) : 0,
    avgTtftMs: streaming?.avgTtftMs ? Math.round(streaming.avgTtftMs) : null,
    fallbackRate: totalRequests ? (t.fallbackCount || 0) / totalRequests : 0,
    judgeCalls: t.judgeCalls || 0,
    judgeCostUsd: t.judgeCostUsd || 0,
  });
});

// GET /v1/admin/timeseries?range=1h|24h|7d - one point per hour (1h/24h) or
// per day (7d), for the "requests over time" / "cache hits" / "cost" charts.
router.get("/v1/admin/timeseries", async (req, res) => {
  const range = RANGE_MS[req.query.range] ? req.query.range : "24h";
  const since = rangeToSince(range);
  const bucketUnit = range === "7d" ? "day" : "hour";

  const buckets = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateTrunc: { date: "$createdAt", unit: bucketUnit } },
        requests: { $sum: 1 },
        errors: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
        cacheHits: { $sum: { $cond: ["$cacheHit", 1, 0] } },
        costUsd: { $sum: "$costUsd" },
        costSavedUsd: { $sum: "$costSavedUsd" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json(
    buckets.map((bucket) => ({
      timestamp: bucket._id,
      requests: bucket.requests,
      errors: bucket.errors,
      cacheHits: bucket.cacheHits,
      costUsd: bucket.costUsd,
      costSavedUsd: bucket.costSavedUsd,
    }))
  );
});

// GET /v1/admin/providers?range=1h|24h|7d - per-provider request count,
// success rate, average latency (all from "attempts", so a fallback
// attempt that failed still counts against the provider that failed it),
// total cost actually billed, and its current circuit breaker state.
router.get("/v1/admin/providers", async (req, res) => {
  const since = rangeToSince(RANGE_MS[req.query.range] ? req.query.range : "24h");

  const attemptStats = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $unwind: "$attempts" },
    {
      $group: {
        _id: "$attempts.provider",
        requestCount: { $sum: 1 },
        successCount: { $sum: { $cond: ["$attempts.success", 1, 0] } },
        avgLatencyMs: { $avg: "$attempts.latencyMs" },
      },
    },
  ]);

  const costStats = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: since }, status: "success" } },
    { $group: { _id: "$provider", totalCostUsd: { $sum: "$costUsd" } } },
  ]);
  const costByProvider = {};
  for (const row of costStats) {
    costByProvider[row._id] = row.totalCostUsd;
  }

  const providerNames = env.PROVIDER_ORDER.split(",").map((name) => name.trim());
  const result = {};

  for (const provider of providerNames) {
    const row = attemptStats.find((r) => r._id === provider);

    result[provider] = {
      requestCount: row?.requestCount ?? 0,
      successRate: row && row.requestCount ? row.successCount / row.requestCount : 0,
      avgLatencyMs: row ? Math.round(row.avgLatencyMs) : 0,
      totalCostUsd: costByProvider[provider] ?? 0,
      circuitState: await getCircuitState(provider),
    };
  }

  res.json(result);
});

// GET /v1/admin/logs?page=&limit=&provider=&status=&cacheType=&apiKeyId= -
// paginated request log, newest first, with optional exact-match filters.
router.get("/v1/admin/logs", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const filter = {};
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.cacheType) filter.cacheType = req.query.cacheType;
  if (req.query.apiKeyId) filter.apiKeyId = req.query.apiKeyId;

  const [logs, total] = await Promise.all([
    RequestLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    RequestLog.countDocuments(filter),
  ]);

  res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

// GET /v1/admin/keys - every API key with its limits, status, and today's
// usage (requests from RequestLog, tokens from the same Redis counter
// rateLimit.service.js uses to enforce tokensPerDay).
router.get("/v1/admin/keys", async (req, res) => {
  const keys = await ApiKey.find().sort({ createdAt: -1 });

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const requestCounts = await RequestLog.aggregate([
    { $match: { createdAt: { $gte: startOfToday } } },
    { $group: { _id: "$apiKeyId", count: { $sum: 1 } } },
  ]);
  const requestsByKey = {};
  for (const row of requestCounts) {
    requestsByKey[String(row._id)] = row.count;
  }

  const result = await Promise.all(
    keys.map(async (key) => ({
      id: key._id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      requestsPerMinute: key.requestsPerMinute,
      tokensPerDay: key.tokensPerDay,
      isActive: key.isActive,
      semanticCacheEnabled: key.semanticCacheEnabled,
      requestsToday: requestsByKey[String(key._id)] ?? 0,
      tokensToday: await getTokensUsedToday(key._id),
      createdAt: key.createdAt,
    }))
  );

  res.json(result);
});

// POST /v1/admin/keys - create a new gateway API key. Body: { name,
// requestsPerMinute?, tokensPerDay?, semanticCacheEnabled? }. Generation
// and hashing are identical to scripts/createApiKey.js - both call
// createApiKey() in apiKey.service.js, so there's exactly one definition
// of "how a key is made" either way.
//
// The raw key is returned ONCE, right here, and never again: only its hash
// (see apiKey.service.js) is stored, the same way auth.js has always
// verified keys - there's no "forgot my key" recovery for the same reason
// a password hash can't be reversed back into a password. If it's lost,
// the only fix is creating a new key (and deactivating/deleting the old one).
router.post("/v1/admin/keys", async (req, res) => {
  const { name, requestsPerMinute, tokensPerDay, semanticCacheEnabled } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const limits = {};
  for (const [field, value] of Object.entries({ requestsPerMinute, tokensPerDay })) {
    if (value === undefined) continue;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return res.status(400).json({ error: `${field} must be a positive number` });
    }
    limits[field] = num;
  }

  const { key, rawKey } = await createApiKey({
    name: name.trim(),
    ...limits,
    semanticCacheEnabled: Boolean(semanticCacheEnabled),
  });

  res.status(201).json({
    id: key._id,
    name: key.name,
    key: rawKey, // shown once - see the comment above
    keyPrefix: key.keyPrefix,
    requestsPerMinute: key.requestsPerMinute,
    tokensPerDay: key.tokensPerDay,
    isActive: key.isActive,
    semanticCacheEnabled: key.semanticCacheEnabled,
    createdAt: key.createdAt,
  });
});

// DELETE /v1/admin/keys/:id - permanently removes an API key (e.g. a test
// key created from the dashboard). Existing RequestLog entries keep their
// apiKeyId as a historical reference even after the key itself is gone -
// nothing else is touched. To disable a key without losing it, use
// PATCH {isActive:false} instead - this is for actually cleaning one up.
router.delete("/v1/admin/keys/:id", async (req, res) => {
  const key = await ApiKey.findByIdAndDelete(req.params.id);
  if (!key) {
    return res.status(404).json({ error: "API key not found" });
  }
  res.json({ id: key._id, deleted: true });
});

// PATCH /v1/admin/keys/:id - toggle isActive and/or semanticCacheEnabled.
// Body: { "isActive": true/false, "semanticCacheEnabled": true/false }
// (either field, or both - anything else is ignored).
router.patch("/v1/admin/keys/:id", async (req, res) => {
  const updates = {};
  if (typeof req.body.isActive === "boolean") {
    updates.isActive = req.body.isActive;
  }
  if (typeof req.body.semanticCacheEnabled === "boolean") {
    updates.semanticCacheEnabled = req.body.semanticCacheEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Provide isActive and/or semanticCacheEnabled as booleans" });
  }

  const key = await ApiKey.findByIdAndUpdate(req.params.id, updates, { new: true });
  if (!key) {
    return res.status(404).json({ error: "API key not found" });
  }

  res.json({
    id: key._id,
    name: key.name,
    isActive: key.isActive,
    semanticCacheEnabled: key.semanticCacheEnabled,
  });
});

// GET /v1/admin/cache-stats - the old /v1/stats/cache payload, kept as-is
// (hit/miss counters + verifier breakdown) since /v1/admin/overview reports
// a different, KPI-shaped summary rather than replacing this one-to-one.
router.get("/v1/admin/cache-stats", async (req, res) => {
  const stats = await getCacheStats();

  const [savings] = await RequestLog.aggregate([
    { $match: { cacheHit: true } },
    {
      $group: {
        _id: null,
        tokensSaved: { $sum: "$tokensSaved" },
        costSavedUsd: { $sum: "$costSavedUsd" },
      },
    },
  ]);

  const outcomeCounts = await RequestLog.aggregate([
    { $match: { verifierOutcome: { $ne: null } } },
    { $group: { _id: "$verifierOutcome", count: { $sum: 1 } } },
  ]);
  const outcomes = {
    rejected_by_guard: 0,
    accepted_high_similarity: 0,
    accepted_by_judge: 0,
    rejected_by_judge: 0,
  };
  for (const row of outcomeCounts) {
    outcomes[row._id] = row.count;
  }

  const [judgeStats] = await RequestLog.aggregate([
    { $match: { judgeUsed: true } },
    {
      $group: {
        _id: null,
        judgeCalls: { $sum: 1 },
        avgJudgeLatencyMs: { $avg: "$judgeLatencyMs" },
        judgeCostUsd: { $sum: "$judgeCostUsd" },
      },
    },
  ]);

  res.json({
    ...stats,
    tokensSaved: savings?.tokensSaved ?? 0,
    costSavedUsd: savings?.costSavedUsd ?? 0,
    verifier: {
      acceptedHighSimilarity: outcomes.accepted_high_similarity,
      acceptedByJudge: outcomes.accepted_by_judge,
      rejectedByGuard: outcomes.rejected_by_guard,
      rejectedByJudge: outcomes.rejected_by_judge,
      judgeCalls: judgeStats?.judgeCalls ?? 0,
      avgJudgeLatencyMs: judgeStats ? Math.round(judgeStats.avgJudgeLatencyMs) : 0,
      judgeCostUsd: judgeStats?.judgeCostUsd ?? 0,
    },
  });
});

export default router;
