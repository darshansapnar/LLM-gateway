// Routes for sending prompts through the provider gateway and inspecting
// past requests.
import { Router } from "express";
import { Types } from "mongoose";
import {
  askWithFallback,
  askWithFallbackStream,
  getPrimaryModel,
  getPrimaryProvider,
} from "../services/router.service.js";
import { RequestLog } from "../models/RequestLog.js";
import { env } from "../config/env.js";
import { auth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { addTokenUsage } from "../services/rateLimit.service.js";
import { calculateCost } from "../services/cost.service.js";
import { embed } from "../services/embedding.service.js";
import {
  findSimilar as findSimilarPrompt,
  store as storeSemanticCache,
  evictEntry as evictSemanticEntry,
} from "../services/semanticCache.service.js";
import { verifyCandidate } from "../services/cacheVerifier.service.js";
import {
  buildCacheKey,
  getCached,
  setCached,
  recordExactHit,
  recordSemanticHit,
  recordMiss,
  recordSemanticSkippedOptOut,
} from "../services/cache.service.js";

const router = Router();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Spreads a cacheVerifier.service.js verdict (or null, if no semantic
// candidate was ever found) into the fields RequestLog expects, so every
// RequestLog.create call below can just do `...judgeLogFields(verdict)`.
function judgeLogFields(verdict) {
  return {
    verifierResult: verdict?.reason ?? null,
    verifierOutcome: verdict?.outcome ?? null,
    judgeUsed: verdict?.judgeUsed ?? false,
    judgeInputTokens: verdict?.judgeInputTokens ?? 0,
    judgeOutputTokens: verdict?.judgeOutputTokens ?? 0,
    judgeCostUsd: verdict?.judgeCostUsd ?? 0,
    judgeLatencyMs: verdict?.judgeLatencyMs ?? 0,
  };
}

// "enabled" only when BOTH the global flag and this key have opted in -
// mirrors the `semanticCacheActive` check below minus the per-request
// conversation-history exception, since this is meant to answer "is
// semantic caching on for this key at all", not "did it run this time".
// Sent as a response header (Playground's Advanced Options section reads
// it) so a caller can tell the two "it didn't hit" cases apart without
// needing admin access to check the key's settings.
function semanticCacheHeaderValue(apiKey) {
  return env.SEMANTIC_CACHE_ENABLED && apiKey.semanticCacheEnabled ? "enabled" : "disabled";
}

// A messages array with prior turns means this request depends on
// conversation context that the exact/semantic caches know nothing about -
// a cached answer to "and what about Tuesday?" from a DIFFERENT conversation
// would be nonsense. Not wired to any actual multi-turn feature yet, but
// checked defensively so semantic caching doesn't quietly do the wrong thing
// if/when one is added.
function hasConversationHistory(req) {
  return Array.isArray(req.body.messages) && req.body.messages.length > 1;
}

// Looks for a semantic cache match for `prompt` under `model`. Computes the
// embedding once (reused by the caller to WRITE the semantic cache on a
// miss, so we never embed the same prompt twice for one request).
//
// A candidate that clears SIMILARITY_THRESHOLD still has to pass
// cacheVerifier.service.js before it's trusted: the antonym guard (instant),
// then either the judge-skip zone or an LLM judge (one short provider call,
// cached in Redis) - see the flow comment on the route below. The full
// `verdict` is returned either way (even on rejection) so the caller can log
// WHY a candidate was turned down and how much the judge cost.
//
// On a bypass request, nothing is read for the purpose of answering - but
// we still check whether this prompt WOULD have matched an existing
// semantic entry (and that entry would have fully passed verification). If
// so, the entry is evicted: bypassing means the caller suspects the last
// answer was wrong, so that entry shouldn't keep being served to anyone else.
//
// Returns { embedding, match, verdict }. `embedding` is null if embedding
// failed or semantic caching isn't active for this request. `match` is null
// if inactive, embedding failed, bypass was requested, nothing was similar
// enough, or a candidate was found but rejected by the verifier. `verdict`
// is null only when no candidate was ever found to verify.
async function lookupSemanticCache(model, prompt, bypassCache, semanticCacheActive) {
  if (!semanticCacheActive) {
    return { embedding: null, match: null, verdict: null };
  }

  const embedding = await embed(prompt);
  if (!embedding) {
    return { embedding: null, match: null, verdict: null };
  }

  if (bypassCache) {
    const staleCandidate = await findSimilarPrompt(model, embedding);
    if (staleCandidate) {
      const staleVerdict = await verifyCandidate(prompt, staleCandidate.prompt, staleCandidate.similarity);
      if (staleVerdict.accepted) {
        await evictSemanticEntry(staleCandidate.key);
      }
    }
    return { embedding, match: null, verdict: null };
  }

  const candidate = await findSimilarPrompt(model, embedding);
  if (!candidate) {
    return { embedding, match: null, verdict: null };
  }

  const verdict = await verifyCandidate(prompt, candidate.prompt, candidate.similarity);
  if (!verdict.accepted) {
    return { embedding, match: null, verdict };
  }

  return { embedding, match: candidate, verdict };
}

// POST /v1/chat - send a prompt through the provider gateway and get back
// the response + usage + cost. Protected: requires a valid API key and
// respects its rate limits.
//
// Cache lookup order: exact match -> semantic (similar-meaning) match ->
// providers. Exact comes first because it's a single cheap Redis GET with
// zero chance of a wrong answer; semantic needs an embedding call and a
// vector search, and carries a small risk of matching a DIFFERENT question
// that merely scores high on similarity - worth trying, but only after the
// free, perfectly-safe option has already failed.
//
// A semantic candidate is never trusted on similarity alone - see
// lookupSemanticCache above and cacheVerifier.service.js:
//   exact hit?            -> return immediately, no embedding, no verifier
//   no semantic candidate? -> normal provider call, no verifier
//   candidate found        -> antonym guard (instant)
//                              rejects -> normal provider call, no LLM judge
//                              passes  -> LLM judge (one short provider call)
//                                          NO  -> normal provider call
//                                          YES -> serve the cached answer
//
// { "stream": true } switches to a Server-Sent Events response instead -
// see handleStreamingChat below.
router.post("/v1/chat", auth, rateLimit, async (req, res) => {
  const { prompt, stream } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({ error: "prompt is required and must be a non-empty string" });
  }

  // Generated up front (not left to Mongo's auto-generated one) so it can go
  // out as a response header right away, even for streaming - where headers
  // have to be written before the matching RequestLog is created at the end.
  // The same value is passed to RequestLog.create's `_id` below/in
  // handleStreamingChat, so "X-Request-Id" really is that log entry's id.
  const requestId = new Types.ObjectId();
  res.set("X-Semantic-Cache", semanticCacheHeaderValue(req.apiKey));
  res.set("X-Request-Id", String(requestId));

  if (stream === true) {
    return handleStreamingChat(req, res, prompt, requestId);
  }

  const bypassCache = req.headers["x-cache-bypass"] === "true";
  const cacheKey = buildCacheKey(getPrimaryModel(), prompt);
  const primaryModel = getPrimaryModel();
  const primaryProvider = getPrimaryProvider();
  const startTime = Date.now();

  // --- Exact cache ---
  if (!bypassCache) {
    const cached = await getCached(cacheKey);

    if (cached) {
      await recordExactHit();
      const latencyMs = Date.now() - startTime;
      const tokensSaved = cached.inputTokens + cached.outputTokens;
      const costSavedUsd = calculateCost(cached.model, cached.inputTokens, cached.outputTokens);

      const fallbackUsed = cached.provider !== primaryProvider;

      await RequestLog.create({
        _id: requestId,
        apiKeyId: req.apiKey._id,
        provider: cached.provider,
        model: cached.model,
        prompt,
        response: cached.text,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs,
        status: "success",
        cacheHit: true,
        cacheType: "exact",
        tokensSaved,
        costUsd: 0,
        costSavedUsd,
        fallbackUsed,
      });

      res.set("X-Cache", "HIT-EXACT");
      res.set("X-Provider", cached.provider);
      return res.json({
        response: cached.text,
        usage: {
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
          totalTokens: tokensSaved,
        },
        latencyMs,
        cached: true,
        cacheType: "exact",
        provider: cached.provider,
        model: cached.model,
        fallbackUsed,
        tokensSaved,
        costUsd: 0,
        costSavedUsd,
        requestId: String(requestId),
      });
    }
  }

  // --- Semantic cache ---
  // Opt-in per key; exact caching above is unaffected and always runs.
  if (env.SEMANTIC_CACHE_ENABLED && !req.apiKey.semanticCacheEnabled) {
    await recordSemanticSkippedOptOut();
  }
  const semanticCacheActive =
    env.SEMANTIC_CACHE_ENABLED && req.apiKey.semanticCacheEnabled && !hasConversationHistory(req);

  const { embedding, match, verdict } = await lookupSemanticCache(
    primaryModel,
    prompt,
    bypassCache,
    semanticCacheActive
  );

  if (match) {
    await recordSemanticHit();
    const latencyMs = Date.now() - startTime;
    const tokensSaved = match.data.inputTokens + match.data.outputTokens;
    const costSavedUsd = calculateCost(match.data.model, match.data.inputTokens, match.data.outputTokens);

    const fallbackUsed = match.data.provider !== primaryProvider;

    await RequestLog.create({
      _id: requestId,
      apiKeyId: req.apiKey._id,
      provider: match.data.provider,
      model: match.data.model,
      prompt,
      response: match.data.text,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: "success",
      cacheHit: true,
      cacheType: "semantic",
      similarity: match.similarity,
      matchedPrompt: match.prompt,
      ...judgeLogFields(verdict),
      tokensSaved,
      costUsd: 0,
      costSavedUsd,
      fallbackUsed,
    });

    res.set("X-Cache", "HIT-SEMANTIC");
    res.set("X-Provider", match.data.provider);
    return res.json({
      response: match.data.text,
      usage: {
        inputTokens: match.data.inputTokens,
        outputTokens: match.data.outputTokens,
        totalTokens: tokensSaved,
      },
      latencyMs,
      cached: true,
      cacheType: "semantic",
      similarity: match.similarity,
      matchedPrompt: match.prompt,
      provider: match.data.provider,
      model: match.data.model,
      fallbackUsed,
      verifierResult: verdict?.reason ?? null,
      tokensSaved,
      costUsd: 0,
      costSavedUsd,
      requestId: String(requestId),
    });
  }

  // --- Full miss: ask a provider, then save to both caches ---
  try {
    const result = await askWithFallback(prompt);
    const latencyMs = Date.now() - startTime;
    const totalTokens = result.inputTokens + result.outputTokens;
    const costUsd = calculateCost(result.model, result.inputTokens, result.outputTokens);
    const fallbackUsed = result.provider !== primaryProvider;

    await addTokenUsage(req.apiKey._id, totalTokens);

    const cacheData = {
      text: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
      provider: result.provider,
    };

    await setCached(cacheKey, cacheData);
    if (embedding) {
      await storeSemanticCache(primaryModel, prompt, embedding, cacheData);
    }

    if (!bypassCache) {
      await recordMiss();
    }

    await RequestLog.create({
      _id: requestId,
      apiKeyId: req.apiKey._id,
      provider: result.provider,
      model: result.model,
      prompt,
      response: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens,
      latencyMs,
      status: "success",
      cacheHit: false,
      cacheType: "none",
      ...judgeLogFields(verdict),
      costUsd,
      costSavedUsd: 0,
      fallbackUsed,
      attempts: result.attempts,
    });

    res.set("X-Cache", bypassCache ? "BYPASS" : "MISS");
    res.set("X-Provider", result.provider);
    res.json({
      response: result.text,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens,
      },
      latencyMs,
      cached: false,
      cacheType: "none",
      provider: result.provider,
      model: result.model,
      fallbackUsed,
      attempts: result.attempts,
      ...(verdict ? { verifierResult: verdict.reason } : {}),
      costUsd,
      requestId: String(requestId),
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const attempts = error.attempts || [];

    await RequestLog.create({
      _id: requestId,
      apiKeyId: req.apiKey._id,
      provider: "none",
      model: "none",
      prompt,
      latencyMs,
      status: "error",
      errorMessage: error.message,
      ...judgeLogFields(verdict),
      attempts,
    });

    res.status(502).json({
      error: "All providers failed",
      details: error.message,
      attempts,
      requestId: String(requestId),
    });
  }
});

// Handles POST /v1/chat when the body has { "stream": true }. Keeps the
// connection open as Server-Sent Events: one "data: {...}\n\n" line per text
// piece, then a final "done" (or "error") event before closing. Cache
// lookup order and the exact/semantic/none bookkeeping mirror the
// non-streaming handler above - only HOW the cached answer is delivered
// (streamed in small chunks instead of one JSON blob) differs.
async function handleStreamingChat(req, res, prompt, requestId) {
  const bypassCache = req.headers["x-cache-bypass"] === "true";
  const cacheKey = buildCacheKey(getPrimaryModel(), prompt);
  const primaryModel = getPrimaryModel();
  const primaryProvider = getPrimaryProvider();
  const startTime = Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // tell proxies (e.g. nginx) not to buffer this response
  });

  function sendEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  let ttftMs = null;
  let clientDisconnected = false;
  const clientAbortController = new AbortController();

  // The client closing the connection (tab closed, request aborted, etc.)
  // fires this - we stop writing and cancel whatever provider call is live.
  // This has to be res.on("close"), not req.on("close"): by this point
  // express.json() has already fully consumed and ended the request body,
  // so req's own close event has nothing left to fire for. res tracks the
  // actual response connection's lifecycle, including an early disconnect.
  res.on("close", () => {
    clientDisconnected = true;
    clientAbortController.abort();
  });

  // Replays cached text (from either cache) as small paced chunks instead
  // of dumping it all at once, and logs/responds identically either way.
  async function streamCachedAnswer(data, cacheType, similarity, matchedPrompt, verdict) {
    const CHUNK_SIZE = 20;
    for (let i = 0; i < data.text.length; i += CHUNK_SIZE) {
      if (clientDisconnected) break;
      if (ttftMs === null) ttftMs = Date.now() - startTime;
      sendEvent({ delta: data.text.slice(i, i + CHUNK_SIZE) });
      await sleep(15); // small pacing so it visibly streams instead of dumping instantly
    }

    const latencyMs = Date.now() - startTime;
    const tokensSaved = data.inputTokens + data.outputTokens;
    const costSavedUsd = calculateCost(data.model, data.inputTokens, data.outputTokens);
    const fallbackUsed = data.provider !== primaryProvider;

    if (!clientDisconnected) {
      sendEvent({
        done: true,
        provider: data.provider,
        model: data.model,
        usage: { inputTokens: data.inputTokens, outputTokens: data.outputTokens, totalTokens: tokensSaved },
        costUsd: 0,
        costSavedUsd,
        cached: true,
        cacheType,
        similarity,
        matchedPrompt,
        fallbackUsed,
        ...(verdict ? { verifierResult: verdict.reason } : {}),
        tokensSaved,
        latencyMs,
        ttftMs,
        requestId: String(requestId),
      });
      res.end();
    }

    await RequestLog.create({
      _id: requestId,
      apiKeyId: req.apiKey._id,
      provider: data.provider,
      model: data.model,
      prompt,
      response: data.text,
      latencyMs,
      status: clientDisconnected ? "cancelled" : "success",
      cacheHit: true,
      cacheType,
      similarity,
      matchedPrompt,
      ...judgeLogFields(verdict),
      tokensSaved,
      costUsd: 0,
      costSavedUsd,
      fallbackUsed,
      stream: true,
      ttftMs,
    });
  }

  // --- Exact cache ---
  if (!bypassCache) {
    const cached = await getCached(cacheKey);
    if (cached) {
      await recordExactHit();
      await streamCachedAnswer(cached, "exact", null, null, null);
      return;
    }
  }

  // --- Semantic cache ---
  // Opt-in per key; exact caching above is unaffected and always runs.
  if (env.SEMANTIC_CACHE_ENABLED && !req.apiKey.semanticCacheEnabled) {
    await recordSemanticSkippedOptOut();
  }
  const semanticCacheActive =
    env.SEMANTIC_CACHE_ENABLED && req.apiKey.semanticCacheEnabled && !hasConversationHistory(req);

  const { embedding, match, verdict } = await lookupSemanticCache(
    primaryModel,
    prompt,
    bypassCache,
    semanticCacheActive
  );

  if (match) {
    await recordSemanticHit();
    await streamCachedAnswer(match.data, "semantic", match.similarity, match.prompt, verdict);
    return;
  }

  // --- Full miss: stream live from the provider, collecting the full text
  // as it goes so a successful stream can still be cached afterward. ---
  let collectedText = "";
  let result;

  try {
    result = await askWithFallbackStream(prompt, {
      clientSignal: clientAbortController.signal,
      onDelta: (delta) => {
        if (ttftMs === null) ttftMs = Date.now() - startTime;
        collectedText += delta;
        if (!clientDisconnected) sendEvent({ delta });
      },
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const status = error.clientDisconnected ? "cancelled" : "error";

    if (!clientDisconnected) {
      sendEvent({ error: error.message, attempts: error.attempts || [], requestId: String(requestId) });
      res.end();
    }

    await RequestLog.create({
      _id: requestId,
      apiKeyId: req.apiKey._id,
      provider: "none",
      model: "none",
      prompt,
      response: collectedText || undefined,
      latencyMs,
      status,
      errorMessage: error.message,
      ...judgeLogFields(verdict),
      attempts: error.attempts || [],
      stream: true,
      ttftMs,
    });
    return;
  }

  const latencyMs = Date.now() - startTime;
  const totalTokens = result.inputTokens + result.outputTokens;
  const costUsd = calculateCost(result.model, result.inputTokens, result.outputTokens);
  const fallbackUsed = result.provider !== primaryProvider;

  // The provider call genuinely completed, so we know the real token count -
  // charge for it and cache it even if the client left just before this point.
  await addTokenUsage(req.apiKey._id, totalTokens);

  const cacheData = {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    model: result.model,
    provider: result.provider,
  };

  await setCached(cacheKey, cacheData);
  if (embedding) {
    await storeSemanticCache(primaryModel, prompt, embedding, cacheData);
  }

  if (!bypassCache) {
    await recordMiss();
  }

  if (!clientDisconnected) {
    sendEvent({
      done: true,
      provider: result.provider,
      model: result.model,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens,
      },
      costUsd,
      cached: false,
      cacheType: "none",
      fallbackUsed,
      attempts: result.attempts,
      ...(verdict ? { verifierResult: verdict.reason } : {}),
      latencyMs,
      ttftMs,
      requestId: String(requestId),
    });
    res.end();
  }

  await RequestLog.create({
    _id: requestId,
    apiKeyId: req.apiKey._id,
    provider: result.provider,
    model: result.model,
    prompt,
    response: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens,
    latencyMs,
    status: clientDisconnected ? "cancelled" : "success",
    cacheHit: false,
    cacheType: "none",
    ...judgeLogFields(verdict),
    costUsd,
    fallbackUsed,
    attempts: result.attempts,
    stream: true,
    ttftMs,
  });
}

// /v1/logs, /v1/stats/cache, and /v1/stats/providers moved to
// src/routes/admin.routes.js under /v1/admin/... (protected by adminAuth,
// and /v1/admin/providers and /v1/admin/overview absorbed + expanded what
// used to live here) - see that file and docs/dashboard.md.

export default router;
