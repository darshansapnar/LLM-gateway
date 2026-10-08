// Builds the "what actually happened in THIS request" checklist from real
// response data only - every line here traces back to a status code,
// header, or JSON field the backend returned. Nothing is invented: a
// rejected semantic candidate's similarity score, for instance, isn't in
// the response today (only the hit path returns `similarity`), so it's
// simply not shown rather than guessed.
//
// Returns an array of { state: "ok" | "fail" | "skip", label, detail }.
function step(state, label, detail) {
  return { state, label, detail };
}

export function buildFlowSummary({
  status,
  retryAfter,
  cacheType,
  verifierResult,
  fallbackUsed,
  attempts,
  bypassed,
  semanticCacheHeader,
}) {
  const steps = [];

  if (status === 401) {
    steps.push(step("fail", "Auth", "Invalid or missing API key"));
    return steps;
  }
  steps.push(step("ok", "Auth", "API key accepted"));

  if (status === 429) {
    steps.push(step("fail", "Rate limit", retryAfter ? `Exceeded - retry after ${retryAfter}s` : "Exceeded"));
    return steps;
  }
  steps.push(step("ok", "Rate limit", "Within limits"));

  if (bypassed) {
    steps.push(step("skip", "Exact cache", "Bypassed (x-cache-bypass)"));
    steps.push(step("skip", "Semantic cache", "Bypassed (x-cache-bypass)"));
  } else if (cacheType === "exact") {
    steps.push(step("ok", "Exact cache", "HIT"));
    steps.push(step("ok", "Cached response", "Served from cache - no provider call"));
    return steps;
  } else {
    steps.push(step("fail", "Exact cache", "MISS"));

    if (cacheType === "semantic") {
      steps.push(step("ok", "Semantic cache", `HIT${verifierResult ? ` - ${verifierResult}` : ""}`));
      steps.push(step("ok", "Cached response", "Served from cache - no provider call"));
      return steps;
    }

    const rejected = verifierResult && !verifierResult.toLowerCase().startsWith("accepted");
    if (rejected) {
      steps.push(step("ok", "Semantic candidate found", "A similar cached prompt was found"));
      steps.push(step("fail", "Rejected by verifier", verifierResult));
    } else if (semanticCacheHeader === "disabled") {
      steps.push(step("skip", "Semantic cache", "Disabled for this key"));
    } else {
      steps.push(step("fail", "Semantic cache", "MISS"));
    }
  }

  if (status >= 500) {
    steps.push(step("fail", "Router", "All providers failed"));
    pushAttempts(steps, attempts);
    return steps;
  }

  steps.push(step("ok", "Router", "Routed to a provider"));
  pushAttempts(steps, attempts);
  steps.push(step("ok", "Response", "Generated"));
  steps.push(step("ok", "Cached", "Stored for future requests"));
  steps.push(step("ok", "Logged", "Request recorded"));

  return steps;
}

// Each attempt is one provider try; a provider seen more than once means
// it was retried. `fallbackUsed`/the attempts list together are what
// distinguish "retry" (same provider again) from "fallback" (a different
// provider) - both are just consecutive attempts entries here.
function pushAttempts(steps, attempts) {
  const seenCount = new Map();
  for (const attempt of attempts || []) {
    const count = seenCount.get(attempt.provider) || 0;
    seenCount.set(attempt.provider, count + 1);
    const label = count > 0 ? `${attempt.provider} (retry ${count})` : attempt.provider;
    if (attempt.success) {
      steps.push(step("ok", label, `${attempt.latencyMs}ms`));
    } else {
      steps.push(step("fail", label, attempt.error || "failed"));
    }
  }
}
