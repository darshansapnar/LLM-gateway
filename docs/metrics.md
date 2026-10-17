# LLM Gateway - Metrics Report

Generated 2026-10-11T09:15:30.476Z by `npm run metrics` (scripts/metrics-report.js).

## 1. Latency

20 new prompts (provider call), the same 20 repeated (exact cache hit), and 20 paraphrases of a second set of 20 (semantic cache hit) - sent as real HTTP requests into the gateway with providers mocked in-process (a randomized 50-200ms delay stands in for a real provider round-trip).

| Path | Median latency | Samples |
| --- | --- | --- |
| Provider call (full miss) | 125.5ms | 20 |
| Exact cache hit | 2.0ms | 20 |
| Semantic cache hit | 4.0ms | 20 |

## 2. Semantic cache eval (held-out test split)

60/60 pairs scored (the rest skipped on an embedding API error, e.g. a free-tier quota hit). Threshold per mode is chosen on the tune split (lowest wrong-hit rate, then highest hit rate), then reported on the held-out test split - see scripts/evalSemanticCache.js.

| Mode | Threshold | Hit rate | Wrong-hit rate |
| --- | --- | --- | --- |
| 1. Embeddings only | 0.95 | 83.3% | 0.0% |
| 2. + antonym guard | 0.95 | 83.3% | 0.0% |
| 3. + antonym guard + judge | 0.85 | 100.0% | 0.0% |

## 3. PII eval

40 cases from scripts/piiEvalSet.json. Average time to mask one case: **0.0218ms**.

| Type | Precision | Recall |
| --- | --- | --- |
| EMAIL | 100.0% | 100.0% |
| PHONE_IN | 100.0% | 100.0% |
| CARD | 100.0% | 100.0% |
| AADHAAR | 100.0% | 100.0% |
| PAN | 100.0% | 100.0% |
| SECRET | 100.0% | 100.0% |
| Overall | 100.0% | 100.0% |

## 4. Test count

Same files `npm test` runs (`tests/unit/**/*.test.js`, `tests/integration/**/*.test.js`, `tests/pii.route.test.js`).

| Tests | Passed | Failed |
| --- | --- | --- |
| 71 | 71 | 0 |

## 5. Fallback

Groq forced to fail (400, not retried - immediate switch to Gemini) across 10 fresh trials (circuit breaker + caches reset between trials). Median end-to-end latency until Gemini's answer comes back.

| Median time to Gemini answer | Successful trials |
| --- | --- |
| 110.0ms | 10/10 |

