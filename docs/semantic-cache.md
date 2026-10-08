# Semantic caching

Exact-match caching (Stage 3) only helps when a prompt is byte-for-byte
identical to one seen before. Semantic caching (Stage 6) also matches
prompts that mean the same thing but are worded differently - "How do I
start a node server?" and "What command launches a node.js server?" should
both get the same cached answer.

## Lookup order

Every `POST /v1/chat` (streaming or not) checks, in order:

1. **Exact cache** - a single Redis `GET`. Free, zero risk of a wrong
   answer. Always on for every API key.
2. **Semantic cache** - only if the key has opted in (see below), the
   feature is on globally, and the request has no conversation history.
   Costs one embedding call and a vector search, and carries a small risk
   of matching a *different* question - so it only runs after the free,
   risk-free option has already missed.
3. **A real provider call** - if neither cache had an answer.

## Opt-in per API key

Semantic caching is **off by default** for every key. Exact caching is
unaffected and always runs regardless.

```bash
npm run create-key -- "my-app"              # exact caching only
npm run create-key -- "my-app" --semantic   # exact + semantic caching
```

This is controlled by `ApiKey.semanticCacheEnabled` (boolean, default
`false`). The gateway also has a global `SEMANTIC_CACHE_ENABLED` switch in
`.env` - semantic caching only actually runs when **both** the key has
opted in **and** the global switch is on:

```js
const semanticCacheActive =
  env.SEMANTIC_CACHE_ENABLED && req.apiKey.semanticCacheEnabled && !hasConversationHistory(req);
```

Why opt-in instead of on-by-default: semantic matching has a real,
measured risk of returning a wrong answer (see "Known limitations" below).
A team that wants that risk-for-speed tradeoff can turn it on per key;
everyone else keeps the zero-risk exact cache only.

## Conversation history safety

If a request includes a `messages` array with more than one entry, semantic
caching is skipped for that request (exact caching still runs). A follow-up
question like "and what about Tuesday?" only means something in the context
of its own conversation - matching it against a semantically-similar prompt
from a *different* conversation would return nonsense. This repo doesn't
actually accept multi-turn `messages` yet, but the check is in place
defensively so adding that feature later doesn't silently make semantic
caching unsafe.

## The verification pipeline

A candidate that clears `SIMILARITY_THRESHOLD` (default 0.90 - deliberately
low; see below) still has to pass `src/services/cacheVerifier.service.js`
before it's trusted:

1. **Antonym guard** (instant, no API call) - tokenizes both prompts,
   finds the words unique to each side, and rejects if those words are a
   listed antonym pair (`src/config/antonyms.js`), an automatically-detected
   "un-"/"dis-" prefix pair (lock/unlock, enable/disable), or if the two
   prompts mention different numbers.
2. **Judge-skip zone** (instant) - if the antonym guard passes and
   similarity ≥ `JUDGE_SKIP_ABOVE` (default 0.97) with no entity difference
   (next point), the candidate is accepted outright, no judge call spent.
3. **Entity check** - if the words unique to each prompt include a
   capitalized word (except each prompt's own first word, which is
   capitalized regardless of content) or a known programming
   language/framework/product name (`src/config/techTerms.js`), the judge
   is always consulted even above `JUDGE_SKIP_ABOVE`. This is what catches
   "France"/"Spain", "Python"/"Java", "React"/"Vue" - pairs that share a
   sentence template but need completely different answers.
4. **LLM judge** (`SEMANTIC_JUDGE_ENABLED` default true, `JUDGE_TIMEOUT_MS`
   default 3000) - asks the primary provider "do these two questions
   require the same answer? YES or NO". Any failure or timeout defaults to
   NO - a missed cache hit is far cheaper than a wrong answer. Judge
   decisions are cached in Redis (keyed by both prompts, normalized and
   sorted so order doesn't matter), with the same TTL as the answer caches,
   so the same pair is never judged twice.

```
Request
  → Exact cache hit?        → return (no embedding, no judge)
  → Semantic caching inactive (opted out / globally off / has history)?
                            → normal provider call (no embedding, no judge)
  → No similar candidate?   → normal provider call (no judge)
  → Candidate found
      → Antonym guard rejects? → normal provider call (no judge)
      → Similarity ≥ JUDGE_SKIP_ABOVE and no entity difference?
                               → accepted, no judge
      → Otherwise              → LLM judge decides
```

## Regenerate eviction

If a request sets `x-cache-bypass: true`, both caches are skipped for
*reading* (a fresh answer is always generated), but the fresh answer is
still *written* to both afterward - same as before. On top of that, if
semantic caching is active for the key, the gateway checks whether this
exact prompt would currently have matched an existing semantic entry (full
verification, not just similarity) - and if so, deletes that entry. Sending
`x-cache-bypass: true` is a signal that the caller thinks the cached answer
was wrong or stale; evicting it means the next person to ask a similar
question doesn't get served the same mistake.

## Config reference

| Variable | Default | Meaning |
|---|---|---|
| `SEMANTIC_CACHE_ENABLED` | `true` | Global on/off switch. Still needs the calling key to opt in. |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | Gemini embedding model. |
| `EMBEDDING_DIM` | `768` | Truncated output dimension (native is 3072). |
| `SIMILARITY_THRESHOLD` | `0.90` | The "plausible candidate" bar - deliberately low; the verifier does the real separation. |
| `SEMANTIC_JUDGE_ENABLED` | `true` | Whether the LLM judge step runs at all. |
| `JUDGE_TIMEOUT_MS` | `3000` | Per-judge-call timeout; a timeout defaults to NO (reject). |
| `JUDGE_SKIP_ABOVE` | `0.97` | Similarity above which the judge is skipped (unless there's an entity difference). |

## Known limitations (measured, not assumed)

- Embedding similarity alone cannot safely separate true paraphrases
  (typically 0.91-0.99) from two kinds of wrong match: antonym-style
  opposites (0.83-0.955, e.g. "lock"/"unlock") and same-template-different-
  topic pairs (0.85-0.94, e.g. "capital of France" vs "capital of Spain").
  This is why the verification pipeline exists at all.
- With the full pipeline (antonym guard + skip-zone + entity-check +
  judge), the eval set's held-out **test split reached 100% accuracy and
  0% wrong-hit rate**, using real provider calls for only the pairs that
  actually needed the judge (most were resolved for free). See
  `npm run eval-cache`'s output for the latest numbers - re-run it after
  any change to the embedding, thresholds, or verifier logic.
- The embedding call depends on Gemini's API and has a real rate limit on
  the free tier (100 embed requests/minute). `embed()` fails soft (returns
  `null`) on any error, so a quota hit just means that one request skips
  semantic caching - never a broken request.

## Testing

```bash
npm run eval-cache              # accuracy/wrong-hit-rate across 3 modes, tune/test split
npm run clear-semantic-cache    # wipe + recreate the index (after an embedding change)
npm run create-key -- <name> --semantic   # make a key that can use semantic caching
```

`GET /v1/stats/cache` reports exact/semantic hit counts, misses, hit rate,
`semanticSkippedOptOut` (requests that reached the semantic-cache-eligible
point but skipped it because the key hadn't opted in), cumulative tokens/
cost saved, and a `verifier` breakdown (`acceptedHighSimilarity`,
`acceptedByJudge`, `rejectedByGuard`, `rejectedByJudge`, `judgeCalls`,
`avgJudgeLatencyMs`, `judgeCostUsd`).
