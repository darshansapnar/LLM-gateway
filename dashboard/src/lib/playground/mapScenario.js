// Picks the Request Flow scenario (by id - see
// lib/request-flow/scenarios.js) that best matches what a REAL Playground
// request actually did, so "View Full Request Flow" opens something true
// to what just happened instead of always the same generic scenario.
//
// Every check here is driven by a real signal in the response - there's no
// way to detect two of the 15 scripted scenarios from a single response,
// and this says so rather than guessing:
//   - "circuit-open": a provider whose circuit is open is simply never
//     attempted, so it leaves no trace in `attempts` to tell apart from
//     "that provider isn't configured" - not detected.
//   - "exact-miss" / "semantic-miss" have no dedicated target id in the
//     task's mapping; a genuine miss (nothing cached, nothing rejected)
//     falls through to "normal", which is the closest scripted scenario.
export function mapScenarioId({
  status,
  cacheType,
  verifierResult,
  fallbackUsed,
  attempts,
  stream,
  bypassed,
  semanticCacheHeader,
}) {
  if (status === 401) return "invalid-key";
  if (status === 429) return "rate-limited";

  if (bypassed) return "cache-bypass";

  if (cacheType === "exact") return "exact-hit";

  if (cacheType === "semantic") {
    // Only an ACCEPTED candidate reaches this branch, so "judge" in the
    // reason text here always means accepted-by-judge, never rejected.
    if (verifierResult && verifierResult.toLowerCase().includes("judge")) return "semantic-judge-accepted";
    return "semantic-hit";
  }

  // cacheType is "none" (or absent) from here on - either a genuine miss,
  // a semantic candidate that was found and rejected, or semantic caching
  // not running at all for this key.
  const rejected = verifierResult && !verifierResult.toLowerCase().startsWith("accepted");
  if (rejected) return "semantic-guard-rejected";

  const providersTried = new Set((attempts || []).map((a) => a.provider));
  if (fallbackUsed || providersTried.size > 1) return "fallback";
  if ((attempts?.length || 0) > 1 && providersTried.size === 1) return "groq-retry";

  if (stream) return "streaming";

  if (semanticCacheHeader === "disabled") return "semantic-skipped";

  return "normal";
}
