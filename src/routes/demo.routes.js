// Public Demo Mode routes:
// 1. POST /demo/chat - Keyless demo proxy to chat pipeline with strict rate limits
// 2. GET /demo/stats/* - Aggregated numbers & metadata-only recent requests
//    (prompt/response returned ONLY for visitor's own requests)
import { Router } from "express";
import { executeChatPipeline } from "./chat.routes.js";
import {
  enforceDemoRateLimits,
  getOrCreateDemoApiKey,
  getOrCreateVisitorId,
} from "../services/demo.service.js";
import { RequestLog } from "../models/RequestLog.js";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";
import { getCacheStats } from "../services/cache.service.js";
import { getState as getCircuitState } from "../services/circuitBreaker.service.js";

const router = Router();

const RANGE_MS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function rangeToSince(range) {
  const ms = RANGE_MS[range] || RANGE_MS["24h"];
  return new Date(Date.now() - ms);
}

// Helper to cache aggregated demo stats in Redis for ~10 seconds.
async function getOrSetCache(cacheKey, ttlSeconds, computeFn) {
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Non-fatal if Redis read fails
  }

  const result = await computeFn();

  try {
    await redis.set(cacheKey, JSON.stringify(result), "EX", ttlSeconds);
  } catch {
    // Non-fatal if Redis write fails
  }

  return result;
}

// --------------------------------------------------------------------------
// 1. POST /demo/chat
// --------------------------------------------------------------------------
// Public keyless chat endpoint.
// - Limits from env: DEMO_REQUESTS_PER_HOUR_PER_IP (20), DEMO_DAILY_REQUEST_BUDGET (300),
//   DEMO_MAX_PROMPT_CHARS (500), DEMO_MAX_OUTPUT_TOKENS (300).
// - PII mode is always "mask".
// - Clear 429 messages with Retry-After header.
// - Reuses the exact same chat pipeline as /v1/chat.
router.post("/demo/chat", async (req, res) => {
  // Enforce demo limits (daily budget + hourly per-IP)
  const limitCheck = await enforceDemoRateLimits(req, res);
  if (!limitCheck.allowed) {
    return;
  }

  // Obtain internal demo API key document from MongoDB
  const demoApiKey = await getOrCreateDemoApiKey();
  // Ensure PII mode is always "mask" regardless of key settings
  const apiKey = { ...demoApiKey.toObject(), piiMode: "mask" };

  // Invalidate recent logs cache so caller immediately sees their request in stats
  redis.del("cache:demo:stats:recent-raw").catch(() => {});

  return executeChatPipeline(req, res, {
    apiKey,
    isDemo: true,
    visitorId: limitCheck.visitorId,
    clientIpHash: limitCheck.clientIpHash,
    maxOutputTokens: env.DEMO_MAX_OUTPUT_TOKENS,
    maxPromptChars: env.DEMO_MAX_PROMPT_CHARS,
  });
});

// --------------------------------------------------------------------------
// 2. GET /demo/stats/*
// --------------------------------------------------------------------------

// GET /demo/stats/overview?range=1h|24h|7d - aggregated KPI summary
router.get("/demo/stats/overview", async (req, res) => {
  const range = RANGE_MS[req.query.range] ? req.query.range : "24h";
  const since = rangeToSince(range);
  const cacheKey = `cache:demo:stats:overview:${range}`;

  const data = await getOrSetCache(cacheKey, 10, async () => {
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
          piiRedactedTotal: { $sum: "$piiRedacted" },
          piiBlockedCount: { $sum: { $cond: [{ $eq: ["$status", "blocked"] }, 1, 0] } },
        },
      },
    ]);

    const [streaming] = await RequestLog.aggregate([
      { $match: { createdAt: { $gte: since }, stream: true, ttftMs: { $ne: null } } },
      { $group: { _id: null, avgTtftMs: { $avg: "$ttftMs" } } },
    ]);

    const piiTypeRows = await RequestLog.aggregate([
      { $match: { createdAt: { $gte: since }, piiTypes: { $exists: true, $ne: [] } } },
      { $unwind: "$piiTypes" },
      { $group: { _id: "$piiTypes", count: { $sum: 1 } } },
    ]);
    const piiTypeBreakdown = {};
    for (const row of piiTypeRows) {
      piiTypeBreakdown[row._id] = row.count;
    }

    const t = totals || {};
    const totalRequests = t.totalRequests || 0;

    return {
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
      piiRedactedTotal: t.piiRedactedTotal || 0,
      piiBlockedCount: t.piiBlockedCount || 0,
      piiTypeBreakdown,
    };
  });

  res.json(data);
});

// GET /demo/stats/timeseries?range=1h|24h|7d - time-bucketed request volume and cost
router.get("/demo/stats/timeseries", async (req, res) => {
  const range = RANGE_MS[req.query.range] ? req.query.range : "24h";
  const since = rangeToSince(range);
  const bucketUnit = range === "7d" ? "day" : "hour";
  const cacheKey = `cache:demo:stats:timeseries:${range}`;

  const data = await getOrSetCache(cacheKey, 10, async () => {
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

    return buckets.map((bucket) => ({
      timestamp: bucket._id,
      requests: bucket.requests,
      errors: bucket.errors,
      cacheHits: bucket.cacheHits,
      costUsd: bucket.costUsd,
      costSavedUsd: bucket.costSavedUsd,
    }));
  });

  res.json(data);
});

// GET /demo/stats/providers?range=1h|24h|7d - provider health, success rate, and circuit state
router.get("/demo/stats/providers", async (req, res) => {
  const range = RANGE_MS[req.query.range] ? req.query.range : "24h";
  const since = rangeToSince(range);
  const cacheKey = `cache:demo:stats:providers:${range}`;

  const data = await getOrSetCache(cacheKey, 10, async () => {
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

    return result;
  });

  res.json(data);
});

// GET /demo/stats/cache - cache hit/miss stats and verifier outcome breakdown
router.get("/demo/stats/cache", async (req, res) => {
  const cacheKey = "cache:demo:stats:cache";

  const data = await getOrSetCache(cacheKey, 10, async () => {
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

    return {
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
    };
  });

  res.json(data);
});

// GET /demo/stats/requests - Recent requests list.
// Metadata is public (time, status, cache type, provider, latency, tokens, cost).
// Prompt and response text are returned ONLY for the calling visitor's own requests.
router.get("/demo/stats/requests", async (req, res) => {
  const visitorId = req.cookies?.visitorId || null;
  // Ensure the visitor has an ID cookie assigned if they don't have one yet
  getOrCreateVisitorId(req, res);

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const cacheKey = "cache:demo:stats:recent-raw";

  // Raw request logs are cached in Redis for ~10 seconds
  const rawLogs = await getOrSetCache(cacheKey, 10, async () => {
    return RequestLog.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  });

  const slicedLogs = rawLogs.slice(0, limit);

  // Filter: Prompt and response text are returned ONLY for this visitor's own requests.
  // Other visitors' requests show metadata only.
  const sanitizedLogs = slicedLogs.map((log) => {
    const isOwner = Boolean(visitorId && log.visitorId === visitorId);
    return {
      _id: log._id,
      createdAt: log.createdAt,
      status: log.status,
      cacheType: log.cacheType,
      provider: log.provider,
      model: log.model,
      latencyMs: log.latencyMs,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      totalTokens: log.totalTokens,
      costUsd: log.costUsd,
      costSavedUsd: log.costSavedUsd,
      tokensSaved: log.tokensSaved,
      fallbackUsed: log.fallbackUsed,
      stream: log.stream,
      piiRedacted: log.piiRedacted,
      piiTypes: log.piiTypes,
      isOwner,
      prompt: isOwner ? log.prompt : undefined,
      response: isOwner ? log.response : undefined,
    };
  });

  res.json({ logs: sanitizedLogs, total: sanitizedLogs.length });
});

export default router;
