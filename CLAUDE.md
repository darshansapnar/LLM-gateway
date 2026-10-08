# LLM Gateway

## What this project is
A middleware server between apps and AI providers (Gemini, OpenAI, Claude).
Features: caching, rate limiting, provider fallback, streaming, cost tracking, dashboard.

## Stack
Node.js + Express (ES modules, async/await), MongoDB (mongoose), Redis (later), React + Vite dashboard (Tailwind CSS v4, lucide-react icons, Recharts).

## Providers
- `PROVIDER_ORDER` in .env = "groq,gemini" → **Groq is primary, Gemini is the fallback**. The first entry is also used for the cache key's model.
- `src/services/router.service.js` (`askWithFallback`) tries each provider in order, retrying retryable errors and skipping providers whose circuit breaker is open. Every provider call is wrapped with an AbortController tied to PROVIDER_TIMEOUT_MS, so a slow call is actually cancelled (not just stopped-waiting-on) at the timeout.
- Available providers (in `src/services/providers/index.js`): groq, gemini, openrouter. **OpenRouter is currently optional/unused** - its code stays in the repo for later, but it's not in PROVIDER_ORDER so its service is never called and its env vars aren't required.
- `src/config/env.js` only requires a provider's env vars (e.g. `GEMINI_API_KEY`/`GEMINI_MODEL`) when that provider's name is actually listed in `PROVIDER_ORDER` - add a provider back into the order and its vars become required automatically, no other code changes needed.
- `pricing.js` cost lookups: any OpenRouter model ending in ":free" is always $0 (handled in `cost.service.js`, no pricing.js entry needed). Everything else needs a matching pricing.js entry or costUsd logs a warning and reports $0.

## Streaming (Stage 5)
- `POST /v1/chat` with `{ "stream": true }` responds as Server-Sent Events instead of plain JSON. Without that flag, behavior is 100% unchanged from before Stage 5.
- `src/services/router.service.js`'s `askWithFallbackStream` only allows retries/fallback BEFORE the first chunk is sent to the client. Once streaming has started, any failure ends the stream with an `{"error": ...}` event - no provider switching mid-answer.
- Two timeouts apply: `PROVIDER_TIMEOUT_MS` for the first chunk, `STREAM_IDLE_TIMEOUT_MS` (default 10000) for the gap between any two chunks once streaming has started.
- Client disconnect detection uses `res.on("close", ...)`, NOT `req.on("close", ...)` - by the time our handler runs, `express.json()` has already fully consumed and ended the request body, so `req`'s own close event never fires again. This cost real debugging time - confirmed experimentally, not just in the docs.
- A disconnect aborts the live provider call via AbortController and logs the request with `status: "cancelled"`. We only add to the token counter / compute cost / cache the answer if the provider call actually finished - a cancelled mid-stream request logs $0 cost (we don't have a confirmed final token count to charge for).
- `public/stream-test.html` (served statically via `express.static`) is a minimal manual test page: API key input, prompt textarea, one button, shows live text + final stats JSON.

## Semantic caching (Stage 6)
- Lookup order on every `/v1/chat` call (streaming or not): **exact cache → semantic cache → providers**. Exact is a free, zero-risk Redis GET so it's tried first; semantic costs an embedding call and carries a small risk of matching a *different* question, so it only runs after exact has already failed.
- `src/services/embedding.service.js`: `embed(text)` calls Gemini's embedding model (`EMBEDDING_MODEL`, default `gemini-embedding-001`, dimension `EMBEDDING_DIM`, default 768) with `taskType: "SEMANTIC_SIMILARITY"` (the task type Google's docs recommend for "do these two texts mean the same thing" comparisons), then L2-normalizes the result before returning it - per Google's docs, only the native 3072-dim output is pre-normalized; any truncated output (our 768) is not, and skipping this step measurably distorted similarity scores (see below). Returns `null` on any failure - callers must treat that as "skip semantic caching," never let it break the actual chat request.
- `src/services/semanticCache.service.js`: owns a Redis vector index (`idx:cache:sem`, created once at startup by `ensureSemanticIndex()` if `SEMANTIC_CACHE_ENABLED`) over hashes prefixed `cache:sem:`. `findSimilar(model, embedding)` does a KNN-1 search filtered by model (TAG), converts cosine distance to similarity (`1 - distance`), and only returns a match at or above `SIMILARITY_THRESHOLD` (default 0.92). `store(...)` saves a new entry with the same TTL as the exact cache. `clearSemanticCache()` wipes all entries and recreates the index - needed any time the embedding changes shape (model/dimension/task type/normalization); run via `npm run clear-semantic-cache`.
- The embedding for a given request is computed **once** and reused for both the semantic lookup and (on a full miss) writing the semantic cache entry - never embedded twice for the same request.
- `x-cache-bypass: true` skips *reading* both caches (same as before), but a fresh answer is still written to both afterward. If semantic caching is active for the key, a bypass request also checks whether this prompt would currently match an existing (fully-verified) semantic entry and, if so, evicts it ("regenerate eviction" - see `docs/semantic-cache.md`).
- **Opt-in per API key** (not on by default): `ApiKey.semanticCacheEnabled` (boolean, default `false`). `npm run create-key -- <name> --semantic` creates a key with it on. Semantic caching only actually runs when the key has opted in AND `SEMANTIC_CACHE_ENABLED` is on globally AND the request has no conversation history (a `messages` array with >1 entry - not an actual feature yet, checked defensively). Exact caching is unaffected and always on for every key. Full details in `docs/semantic-cache.md`.
- `RequestLog` now has `cacheType` ("exact"/"semantic"/"none"), `similarity`, `matchedPrompt` (the original prompt a semantic hit actually matched against), and `verifierResult` (see below).
- Fixed a real embedding bug along the way: `embed()` now passes `taskType: "SEMANTIC_SIMILARITY"` (Google's recommended task type for "do these mean the same thing" comparisons) and L2-normalizes the result (required for any non-3072-dim output per Google's docs). Before this fix, a genuine paraphrase ("What is machine learning?" / "Can you define machine learning?") scored 0.78 while an opposite-meaning pair ("lock a file" / "unlock a file") scored 0.92 - backwards. After the fix, paraphrases reliably score 0.91-0.99. `npm run clear-semantic-cache` wipes stored vectors + recreates the index whenever the embedding changes shape like this.

## Cache verification (Stage 6, step 2)
Even after the embedding fix, embedding similarity alone still can't safely separate paraphrases (0.91-0.99) from two different kinds of wrong match: antonym-style opposites (0.83-0.955, e.g. "lock"/"unlock") and same-template-different-topic pairs (0.85-0.94, e.g. "capital of France" vs "capital of Spain" - no antonym involved, just a different answer). `SIMILARITY_THRESHOLD` was lowered to 0.90 (just a "plausible candidate" bar now) and a semantic candidate must also pass `src/services/cacheVerifier.service.js` before it's trusted:
1. **Antonym guard** (instant, no API call) - tokenizes both prompts, finds words unique to each side, and rejects if those words are a listed antonym pair (`src/config/antonyms.js`), an "un-"/"dis-" prefix pair (lock/unlock, enable/disable - detected automatically), or if the two prompts mention different numbers.
2. **Judge-skip zone** (instant) - if the antonym guard passes AND similarity >= `JUDGE_SKIP_ABOVE` (default 0.97) AND there's no entity difference (next point), the candidate is accepted outright with no judge call.
3. **Entity check** - if the words unique to each prompt include a capitalized word (excluding each prompt's first word, which is capitalized regardless of content - "What" vs "Can" isn't an entity), or a known programming language/framework/product name (`src/config/techTerms.js`), that always forces the judge even above `JUDGE_SKIP_ABOVE` - this is what catches "France"/"Spain", "Python"/"Java", "React"/"Vue".
4. **LLM judge** (`SEMANTIC_JUDGE_ENABLED` default true, `JUDGE_TIMEOUT_MS` default 3000) - asks the primary provider "do these two questions require the same answer? YES or NO". Any failure/timeout defaults to NO (reject) - we'd rather miss a cache hit than serve a wrong one. Decisions are cached in Redis, keyed by both normalized prompts sorted (order-independent) with the same TTL as the answer caches - the same pair is never judged twice. Judge tokens/cost/latency are tracked on `RequestLog` (`judgeUsed`, `judgeInputTokens`, `judgeOutputTokens`, `judgeCostUsd`, `judgeLatencyMs`) and surfaced in `GET /v1/admin/cache-stats`.

Flow: exact hit → return (no embedding, no judge). Semantic caching inactive (key opted out / globally off / request has conversation history) → normal provider call. No semantic candidate → normal provider call (no judge). Candidate found, antonym guard rejects → normal provider call (no judge). Candidate found, antonym guard passes, similarity high enough and no entity difference → accepted, no judge. Otherwise → LLM judge decides.

`GET /v1/admin/cache-stats` also reports `semanticSkippedOptOut` - requests that reached the semantic-cache-eligible point (exact cache missed) but skipped it specifically because the calling key hadn't opted in (distinct from the feature being off globally). (This endpoint and `/v1/logs` moved under `/v1/admin/...` in Stage 7 - see below.)

**Measured result, properly tune/test split** (`npm run eval-cache`): `scripts/semanticCacheEvalSet.json`'s 60 pairs each carry a `split: "tune"` (70%) or `"test"` (30%) field. The eval script picks the best threshold per mode using ONLY the tune split, then reports that threshold's real accuracy on the held-out test split - not just whatever threshold happened to fit the full dataset best. Latest run (10 pairs skipped to a Gemini free-tier quota hit, 50 scored): on the test split, Mode 1 (embeddings only) reached 93.3% accuracy but still needed a high threshold (0.95) to hit 0% wrong-hit rate; Mode 2 (+ antonym guard) actually scored a *worse* wrong-hit rate on test (11.1%) than mode 1 at its chosen threshold - a reminder that antonym-only still misses same-template-different-topic pairs entirely; Mode 3 (+ antonym guard + judge, including the skip-zone/entity-check) reached **100% accuracy and 0% wrong-hit rate on the held-out test split**, using only 5 real judge calls for those 15 test pairs (the rest were resolved by the antonym guard or the skip-zone without spending an API call).

`scripts/evalSemanticCache.js` embeds all 60 pairs, runs the antonym guard/entity-check/judge on each, sweeps five thresholds on the tune split to pick the best per mode, and reports that threshold's correct/wrong/missed-hit counts, accuracy, wrong-hit rate, and judge-call count on the test split. Note: scoring all 60 pairs can brush against Gemini's free-tier embedding quota (100 requests/minute, this eval makes ~120); a 429 is caught and that pair is skipped with a warning, not a crash - just re-run if you see skipped pairs. Judge decisions are cached, so re-running the eval after a first full run is much cheaper/faster.

## Admin API + dashboard (Stage 7, Part 1)
- A single shared secret, `ADMIN_API_KEY`, checked via the `x-admin-key` header by `src/middleware/adminAuth.js` - separate from per-caller API keys (`auth.js`), since the dashboard needs to see *across* every key, not act as one of them. Constant-time compare (`crypto.timingSafeEqual`) so a wrong guess can't be timed.
- `src/routes/admin.routes.js` holds everything under `/v1/admin/...` and applies `adminAuth` once via `router.use()` at the top - every route in that file is protected. `/v1/logs` and `/v1/stats/*` from earlier stages moved here: `/v1/logs` → `GET /v1/admin/logs` (now paginated + filterable), `/v1/stats/cache` → `GET /v1/admin/cache-stats` (unchanged payload), `/v1/stats/providers` → absorbed into the new `GET /v1/admin/providers` (range-filterable, success *rate* instead of raw success/failure counts).
- New: `GET /v1/admin/overview?range=1h|24h|7d` (KPI summary: totals, success rate, cost, cost saved, cache hit rate split exact/semantic, avg latency, avg TTFT for streaming, fallback rate, judge calls/cost) and `GET /v1/admin/timeseries?range=` (per-hour buckets for 1h/24h, per-day for 7d, via MongoDB's `$dateTrunc` - needs MongoDB 5.0+, confirmed working on the Atlas cluster this project uses).
- `GET /v1/admin/keys` lists every API key (limits, active, semanticCacheEnabled, requests today from `RequestLog`, tokens today reusing `rateLimit.service.js`'s `getTokensUsedToday`). `PATCH /v1/admin/keys/:id` toggles `isActive` and/or `semanticCacheEnabled`.
- CORS (`cors` package) is mounted globally in `app.js`, allowing only `DASHBOARD_ORIGIN` (default `http://localhost:5173`) and explicitly allowing the `x-admin-key` custom header (browsers don't send custom headers cross-origin unless the server's preflight response explicitly allows them).
- `dashboard/` is a separate React + Vite app (not part of the Node server's module graph - its own `package.json`, run with `npm run dev:dashboard` from the repo root or `npm run dev` inside `dashboard/`). Styled with Tailwind CSS v4 + lucide-react icons, light theme by default with an optional dark mode toggle (both driven by CSS custom properties, see `dashboard/src/index.css`), Recharts for the charts. The admin key is typed in at login and kept only in React state - never localStorage, so a page reload logs out. Auto-refreshes every 10s per section (`usePolling` hook) without flashing a loading spinner on background refreshes - only the first load per view shows one.

## Request Flow page (Stage 7, Part 3)
An animated "Request Flow" page in the dashboard (`dashboard/src/pages/RequestFlow.jsx`) visually walks through 15 scenarios covering the gateway's request lifecycle - auth, rate limiting, exact/semantic caching (including the verifier sub-pipeline), provider routing, retries, fallback, the circuit breaker, streaming, and cache bypass. **It is entirely simulated** - mock/scripted data only, defined in `dashboard/src/lib/request-flow/scenarios.js`. It never calls `/v1/chat` or any other backend endpoint, and no backend code was touched to build it.
- Added as a sixth sidebar nav item using the **same tab-based pattern as every other page** (an entry in `App.jsx`'s `PAGES` map + `Sidebar.jsx`'s `NAV_ITEMS`). At the time this page was built the dashboard had no client-side routing at all; a minimal router was added later, for Playground (Stage 7, Part 4) - see below - and this page now also has a real URL (`/request-flow`) and reads an optional `?scenario=` query param on mount to preselect a scenario (still without auto-playing it) - see `pages/RequestFlow.jsx`'s `initialScenarioId()`.
- Model names shown (`openai/gpt-oss-120b` for Groq, `gemini-3.5-flash-lite` for Gemini) and numbers (300ms retry backoff, 3-failure/30s circuit breaker threshold, 20 req/min & 50,000 tokens/day rate limit, 0.90 similarity candidate bar, 0.97 judge-skip bar) are all read from `.env.example` / this file, not invented.
- The diagram is one fixed-size SVG + absolutely-positioned HTML node cards sharing the same coordinate system (see `lib/request-flow/nodes.js`); it's wrapped in a horizontal-scroll container on narrow screens rather than given a second, simplified mobile layout, so node cards never need to shrink text or crowd together.
- `PageHeader.jsx` (shared by every page) gained an optional `subtitle` prop for this page's byline - backward compatible, every other page simply doesn't pass it.

## Playground page (Stage 7, Part 4)
A Postman-style page (`dashboard/src/pages/Playground.jsx`, route `/playground`) for building and sending **real** requests to `POST /v1/chat` and inspecting the actual response - request/response panels, metric cards, a plain-language "what happened" flow summary, and in-memory request history. Unlike Request Flow, this page makes real network calls - but only ever to the gateway itself (`VITE_API_URL`, same as the rest of the dashboard); it never talks to Groq/Gemini directly, and the gateway API key it sends is kept in React state only (never localStorage), same discipline as the admin key on the login screen.

**Backend changes** (`src/app.js`, `src/routes/chat.routes.js`) - additive only, no existing behavior changed:
- `app.js`: added `exposedHeaders` to the CORS config - `X-Cache`, `X-Provider`, `X-Semantic-Cache`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`, `X-Request-Id`. Without this a browser can't read any of them off a cross-origin response (only a handful of CORS-safelisted headers are visible to `fetch()` by default) - the Headers tab and cache-type detection in Playground depend on it.
- `chat.routes.js`: every `/v1/chat` response (streaming and not) now also sets `X-Semantic-Cache: enabled|disabled` - true only when *both* `SEMANTIC_CACHE_ENABLED` and the calling key's `semanticCacheEnabled` are on, regardless of whether semantic caching actually ran for this particular request (conversation-history opt-out doesn't affect it). This is what drives Playground's "Semantic cache: enabled/disabled for this key" readout.
- `chat.routes.js`: every response now carries an `X-Request-Id` header and a matching `requestId` field in the JSON body / final SSE event - generated up front as a real Mongo `ObjectId` and passed through to `RequestLog.create`'s `_id`, so the header genuinely is that log entry's id. (Generated before the streaming headers are written, since a stream's `RequestLog` isn't created until the stream ends, long after headers have to go out.)
- `chat.routes.js`: successful responses (and the final stream event) now also include, **where the data already existed on the backend but wasn't being returned** - `model`, `fallbackUsed`, `attempts` (full-miss responses), `tokensSaved`/`verifierResult` (cache-hit responses). No field was renamed or removed; `costSavedUsd` and `matchedPrompt` were already present on the hit paths. A rejected semantic candidate's similarity score is deliberately **not** added to the miss-path response - it was never computed into a return-able value anywhere in the existing code, and adding it wasn't on the explicitly allowed list, so Playground's rejected-candidate banner shows the verifier's reason text (e.g. `"antonym: on/off"`) but not a similarity number for that specific case.

**Frontend design notes:**
- `lib/playground/mapScenario.js` matches a real response back to one of Request Flow's 15 scenario ids using only signals the response actually contains. Two things can't be reliably detected this way and are called out in that file's comments rather than guessed: a skipped (circuit-open) provider leaves no trace in `attempts` to tell apart from "not configured", and two scripted scenarios (`exact-miss`, `semantic-miss`) have no dedicated target id, so a genuine miss maps to `normal`.
- `lib/playground/buildFlowSummary.js` builds the "✓ Auth ✓ Rate limit ✕ Exact cache MISS …" checklist the same way - every line traces back to a status code, header, or response field, nothing invented.
- "Re-send" in Request History replays the **exact** request object that was actually sent (captured in a snapshot alongside each history entry), not whatever's currently sitting in the editor - `Playground.jsx`'s `performSend()` takes its request as explicit arguments rather than reading component state, specifically so this is correct.
- A minimal client-side router (`hooks/useRoute.js`) was added so Playground can link to `/request-flow?scenario=<id>` and have that page read it back, and so every page has a real address-bar URL. It's a small fixed path↔tab lookup table plus `history.pushState`/`popstate` - not a routing library; `Sidebar.jsx`'s `onSelect` and every page's new `onNavigate` prop both go through the same `navigate()` function.
- "Remember key on this device" (unchecked by default, next to the API key field) opts the gateway key into `sessionStorage` instead of in-memory-only state - `hooks/useRememberedApiKey.js`. Session storage, not localStorage: it survives a page refresh but is cleared the moment the tab closes, matching "remember on this device", not "remember forever". Unchecking (or clearing the field) removes the stored copy immediately, not just on the next write. **Scope is deliberately narrow**: this hook is wired up only for the gateway key Playground's `AuthSection.jsx` collects - it is never reused for a provider key (`GROQ_API_KEY`/`GEMINI_API_KEY`/`OPENROUTER_API_KEY`, which the frontend never even receives) or `ADMIN_API_KEY` (Login.jsx keeps that in memory only, with no remember option at all).

## API key creation from the dashboard (Stage 7, Part 5)
- `src/services/apiKey.service.js` is the single place that generates and hashes gateway API keys - `hashKey()` (SHA-256, unchanged) and `createApiKey({ name, requestsPerMinute?, tokensPerDay?, semanticCacheEnabled? })`, which creates the raw key (`gw_` + 32 random hex chars), stores only its hash, and returns `{ key, rawKey }`. Both `scripts/createApiKey.js` (CLI) and the new admin route call this same function, so the two can never drift apart. Optional fields are only passed through to `ApiKey.create()` when actually provided, so the schema's own defaults (20/min, 50000/day, semantic caching off) still apply when the CLI is run without them - exactly as before the refactor.
- `POST /v1/admin/keys` (adminAuth-protected): body `{ name, requestsPerMinute?, tokensPerDay?, semanticCacheEnabled? }`. Validates `name` is a non-empty string and that any provided limit is a positive finite number (400 otherwise), calls `createApiKey(...)`, and returns the full raw key **once**, alongside the key's stored details (id, prefix, limits, active state, createdAt).
- `DELETE /v1/admin/keys/:id` (adminAuth-protected): permanently removes a key (404 if not found). This is for actually deleting a key (e.g. a test key); the existing `PATCH /v1/admin/keys/:id` (`{ isActive: false }`) remains the way to temporarily disable one without losing its history/usage.
- `app.js`'s CORS `methods` now includes `"DELETE"` alongside `GET/POST/PATCH`, so the browser's DELETE request isn't blocked by the CORS preflight.
- **Why the key is shown only once:** the server never stores the raw key - only its one-way SHA-256 hash (the same design as a password hash). That means the server itself is physically unable to show the raw key again later; the only moment it ever exists outside the requester's own memory is the single `POST` response right after creation. Showing it then (and only then) is what makes that storage choice safe - if the full key were retrievable later, the hash-only storage would just be security theater.
- **Why only the hash is stored:** anyone who reads the database (a backup, a compromised admin, a stolen snapshot) gets zero usable keys - a SHA-256 hash can't be reversed back into the original key, so the exact one-way guarantee that protects user passwords is reused here for gateway keys. Verification still works because `auth.js` just hashes whatever key the caller sends and compares hashes.
- Dashboard: API Keys page gets a "Create API key" button (`ApiKeysPage.jsx`) that opens `pages/apikeys/CreateKeyDialog.jsx`, a two-step dialog built on the new reusable `components/common/Modal.jsx` (centered dialog, Escape/backdrop/X to close - distinct from `RequestDetailPanel.jsx`'s slide-over). Step 1 is the form (name, requests/min default 20, tokens/day default 50000, semantic cache checkbox) with the same validation as the backend. Step 2 (shown after a successful create) displays the raw key in a highlighted box with a Copy button (`navigator.clipboard`) and a "shown only once" warning - the raw key lives only in this dialog's local state, so closing it discards the key from the dashboard too, same as the server never being able to show it again.
- The table gets a delete icon per row (`window.confirm` before calling the new `deleteKey()` API function, then reloads), consistent with the codebase's existing lightweight `alert()`/`confirm()` usage rather than a custom confirmation modal.
- "Use in Playground" (optional button in the create dialog's success step) hands the freshly-created key to the Playground page **without ever touching the URL or any storage**: `App.jsx` holds a one-shot `playgroundPrefillKey` state, set when the button is clicked and navigated to, read once by `Playground.jsx` in a mount-only `useEffect` (which immediately clears it via `onPrefillConsumed`) so revisiting the Playground tab later doesn't silently re-inject a stale key.

## Docker (Stage 7, Part 2)
Packaging only - one exception: Docker surfaced a real, pre-existing bug in `ensureSemanticIndex()` (see below), which got fixed along with everything else here.

- **`Dockerfile`** (repo root, builds the gateway): two stages. `deps` runs `npm ci --omit=dev` so devDependencies (nodemon) never end up in the shipped image. `runtime` copies just `node_modules` from `deps` plus the folders the server actually needs at runtime (`src/`, `public/`, `scripts/` - `scripts/` so `node scripts/createApiKey.js` still works via `docker compose exec`) and runs as the `node` user that the `node:22-alpine` base image already ships with (uid 1000) - not root. A `HEALTHCHECK` hits the app's own `GET /health` with `wget` (already present in Alpine, no extra install needed).
- **`dashboard/Dockerfile`** (builds the dashboard): a `build` stage compiles the Vite app (`VITE_API_URL` passed in as a build ARG - Vite inlines `import.meta.env.VITE_*` vars into the bundled JS at build time, so this can't be a normal runtime env var the way the gateway's env vars are), then a `runtime` stage copies only the compiled `dist/` output into a vanilla `nginx:alpine` image. `dashboard/nginx.conf` adds one `try_files ... /index.html` rule so client-side routes (`useRoute.js`, e.g. `/playground`) don't 404 on a hard refresh.
- **`.dockerignore` / `dashboard/.dockerignore`**: keep `node_modules`, `.env`, `.git`, and build output (`dist`) out of each image's build context. The gateway's `Dockerfile` only ever `COPY`s specific folders anyway (never `COPY . .`), so this is mostly about not uploading gigabytes of `node_modules` to the Docker daemon on every build.
- **`docker-compose.yml`**: four services -
  - `mongo` (official `mongo:7` image) and `redis` (`redis/redis-stack-server`, **not** plain `redis` - the semantic cache's vector index needs the RediSearch module that only the Stack image ships) each get a named volume (`mongo_data`, `redis_data`) and a `healthcheck`.
  - `gateway` builds from the root `Dockerfile`, loads everything else from `.env` via `env_file`, but its `environment:` block unconditionally overrides `MONGO_URI`/`REDIS_URL` to `mongo`/`redis` (the compose service names) regardless of what's in `.env` - see "why hostnames not localhost" below. `depends_on: condition: service_healthy` means it won't even start until both databases are actually ready, not just "container started".
  - `dashboard` builds from `dashboard/Dockerfile`, with `VITE_API_URL` passed through as a build arg (default `http://localhost:3000` - see the compose file's own comment on why this has to be host-reachable, not the `gateway` service name).
- **The semantic cache's vector index gets created correctly on a fresh container - this took a real bugfix to actually work.** `ensureSemanticIndex()` (`src/services/semanticCache.service.js`, called by `src/index.js` on every startup when `SEMANTIC_CACHE_ENABLED` is on) used to decide "does the index already exist?" by calling `FT.INFO` and checking whether the error text contained `"not found"`. That happened to work against the long-lived local dev Redis (which already had the index from some earlier successful run, so `FT.INFO` always just succeeded) but **crash-looped the gateway on an actually fresh `redis-stack-server` container** - verified by running this stack with brand new volumes - because that Redis Stack version's real error text is `"Unknown index name"`, which doesn't match, so the code re-threw and crashed instead of creating the index. Fixed to be robust instead of matching more error-message substrings:
  - Existence is checked with `FT._LIST` (the actual list of index names) instead of parsing any error text at all - this can't drift out of sync with Redis/RediSearch version wording the way a substring match can.
  - If `FT.CREATE` itself fails with "already exists" (two gateway instances/replicas starting at the same moment can both see "no index yet" and both try to create it), that one specific error is swallowed as a safe no-op - the index exists either way.
  - Any other error is logged clearly and re-thrown - startup fails loudly instead of leaving semantic caching silently broken.
  - `tests/semanticCache.service.test.js` (`npm test`, Node's built-in `node:test` - no new dependency) is an integration test against a real Redis: drops the index if present, confirms `ensureSemanticIndex()` creates it from nothing without throwing, and confirms calling it again is still a safe no-op. This is the first test in the project - `npm test` ran `echo "no test specified"` before.
  - Combined with `depends_on: redis: condition: service_healthy`, the gateway container only starts (and only then calls `ensureSemanticIndex()`) once `redis-cli ping` on the fresh `redis-stack-server` container is actually answering - verified end to end: fresh volumes, `docker compose up`, gateway reached `healthy`, logs showed `Created Redis vector index "idx:cache:sem"`.
- **`.env.docker.example`**: the same values as `.env.example`, plus a `VITE_API_URL` line (read by `docker-compose.yml` itself, as the dashboard build arg) and comments clarifying that `MONGO_URI`/`REDIS_URL` in this file only matter if you run the gateway outside Docker - inside Docker, `docker-compose.yml` always overrides both. Copy it to `.env` before running `npm run docker:up` (the same `.env` the non-Docker setup already uses).
- **npm scripts**: `docker:up` (`docker compose up -d --build`), `docker:down` (`docker compose down`), `docker:logs` (`docker compose logs -f`).

**Why `mongo`/`redis` as hostnames instead of `localhost` inside Docker:** each container gets its own network namespace, so "localhost" inside the `gateway` container means the `gateway` container itself - it would never reach the `mongo`/`redis` containers that way, even though they're all part of the same `docker compose` stack. Compose puts every service in this file on one shared Docker network and registers each service's *name* (`mongo`, `redis`, `gateway`, `dashboard`) as a DNS hostname on that network, resolving to that container's actual internal IP. That's also exactly why the dashboard's `VITE_API_URL` can't use `gateway` as a hostname even though it's running right there in the same compose stack: that name only resolves *inside* the Docker network, but `VITE_API_URL` is fetched from the user's own browser, which is outside it entirely - the browser only has the host-mapped port (`http://localhost:3000`) to go on.

**What volumes and healthchecks do:** a named volume (`mongo_data`, `redis_data`) is storage that lives outside the container's own filesystem layer - `docker compose down` removes the containers, but the volume (and everything Mongo/Redis wrote to it) survives, so the next `docker compose up` picks up right where it left off instead of starting from an empty database every time (only `docker compose down -v` deletes the volumes too). A `healthcheck` is a command Docker runs *inside* the container on a schedule to decide if it's actually working, not just "running" - a container can be alive (process started) while Mongo is still initializing its data files, or Redis hasn't finished loading its module set yet; without a healthcheck, `depends_on` only waits for the container to start, not for it to be ready, which is exactly the kind of race condition that makes "works most of the time" Docker setups flaky.

## Build stages
- [x] Stage 0: Setup (Express, MongoDB, env config, /health)
- [x] Stage 1: Basic proxy to Gemini + request logging
- [x] Stage 2: API keys + rate limiting (Redis)
- [x] Stage 3: Exact-match caching (Redis)
- [x] Stage 4: Multiple providers + fallback
- [x] Stage 5: Streaming
- [x] Stage 6: Semantic caching
- [x] Stage 7, Part 1: React dashboard
- [x] Stage 7, Part 5: Create/delete API keys from the dashboard
- [x] Stage 7, Part 2: Docker Compose (GitHub Actions still pending)
- [x] Stage 7, Part 3: Request Flow page (simulated request lifecycle walkthrough)
- [x] Stage 7, Part 4: Playground page (real requests to the gateway, Postman-style)

## Rules
- I'm learning: build ONLY the current stage, never jump ahead.
- Keep code simple and well-commented.
- After each change, explain what each file does in simple words.
- Never hardcode secrets; use .env.
- Structure: src/config, src/routes, src/models, src/services (add src/middleware as needed).

## Folder structure
```
Dockerfile                  - multi-stage build for the gateway (see "Docker" below)
docker-compose.yml           - mongo + redis (redis-stack-server) + gateway + dashboard, all wired
                               together for local/self-hosted use
.dockerignore, dashboard/.dockerignore - keep node_modules/.env/dist out of the build context
.env.docker.example          - like .env.example, but documents the Docker-specific overrides
                               (MONGO_URI/REDIS_URL/VITE_API_URL) - see "Docker" below
src/
  app.js                    - builds the Express app, mounts routes, serves public/ statically
  index.js                  - entry point: connects DB + Redis, starts server
  config/
    env.js                  - loads & validates environment variables
    db.js                   - connects to MongoDB via mongoose
    redis.js                - connects to Redis via ioredis
    pricing.js              - USD price per 1M tokens per model (PLACEHOLDER values - verify before trusting)
    antonyms.js             - word pairs the antonym guard treats as opposite in meaning
    techTerms.js            - programming languages/frameworks/products the entity check always sends to the judge
  routes/
    health.routes.js        - GET /health
    chat.routes.js          - POST /v1/chat (auth + rate limit + exact/semantic cache + fallback + streaming)
    admin.routes.js         - everything under /v1/admin/... (adminAuth-protected): overview, timeseries,
                               providers, logs (paginated+filtered), keys (list+PATCH), cache-stats
  middleware/
    auth.js                 - verifies "Authorization: Bearer <key>" against ApiKey collection
    adminAuth.js            - verifies "x-admin-key" against ADMIN_API_KEY (constant-time compare)
    rateLimit.js             - fixed-window requests/minute + tokens/day limits (Redis)
  services/
    providers/
      index.js               - registry mapping provider name -> its ask/askStream functions
      groq.service.js         - talks to the Groq API, normalizes the result; askGroq + askGroqStream
      gemini.service.js       - talks to the Gemini API, normalizes the result; askGemini + askGeminiStream
      openrouter.service.js   - talks to OpenRouter (OpenAI-compatible REST, no SDK), normalizes the result (currently unused, not in PROVIDER_ORDER, no streaming version yet)
    router.service.js        - askWithFallback() (non-streaming) and askWithFallbackStream() (streaming,
                               fallback/retry only before the first chunk); both circuit-breaker aware
    circuitBreaker.service.js - per-provider CLOSED/OPEN/HALF_OPEN state in Redis
    cost.service.js          - calculateCost(model, inputTokens, outputTokens) using pricing.js (":free" models are always $0)
    rateLimit.service.js    - reads/writes today's per-key token-usage counter in Redis
    cache.service.js        - exact-match prompt cache (key building, get/set, exact/semantic/miss stats) in Redis
    embedding.service.js    - embed(text) via Gemini's embedding model; returns null on failure (never breaks the request)
    semanticCache.service.js - Redis vector index (idx:cache:sem): ensureSemanticIndex, findSimilar
                               (now returns the entry's Redis key too), store, evictEntry, clearSemanticCache
    cacheVerifier.service.js - antonymGuard + hasEntityDifference + llmJudge + verifyCandidate -
                               double-checks a semantic candidate before it's trusted (see "Cache
                               verification" above); llmJudge caches its decisions in Redis
    apiKey.service.js       - hashKey() + createApiKey(): the one place that generates/hashes gateway
                               API keys, shared by scripts/createApiKey.js and POST /v1/admin/keys
  models/
    RequestLog.js           - mongoose schema for logged requests (costUsd, costSavedUsd, fallbackUsed,
                               attempts[], stream, ttftMs, cacheType, similarity, matchedPrompt,
                               verifierResult, verifierOutcome, judgeUsed, judgeInputTokens,
                               judgeOutputTokens, judgeCostUsd, judgeLatencyMs;
                               status can be "success"/"error"/"cancelled")
    ApiKey.js               - mongoose schema for gateway API keys (stores only a key hash;
                               semanticCacheEnabled default false - opt-in)
public/
  stream-test.html          - manual test page for streaming (served statically at /stream-test.html)
docs/
  semantic-cache.md         - full semantic caching writeup: opt-in, verification pipeline, eviction,
                               config reference, measured limitations
scripts/
  createApiKey.js           - CLI: node scripts/createApiKey.js <name> [--semantic] (or
                               npm run create-key -- <name> --semantic)
  evalSemanticCache.js      - CLI: npm run eval-cache - tunes a threshold per mode on the tune split,
                               reports accuracy/wrong-hit-rate/judge-calls on the held-out test split
  semanticCacheEvalSet.json - 60 hand-written prompt pairs (paraphrases, antonym negatives,
                               same-template-different-topic negatives), each tagged split: "tune"/"test"
  clearSemanticCache.js     - CLI: npm run clear-semantic-cache - wipes stored vectors + recreates the index
                               (needed after any change to how embeddings are computed)
tests/
  semanticCache.service.test.js - npm test (Node's built-in node:test, no extra dependency): integration
                               test that ensureSemanticIndex() builds the vector index from nothing on an
                               empty Redis and that calling it again is a safe no-op - see "Docker" below
dashboard/                  - separate React + Vite app (own package.json/node_modules), not required for
                               the API to run. Tailwind CSS v4 + lucide-react icons + Recharts, styled as
                               a Stripe/Vercel-like light-first dashboard with an optional dark mode toggle.
                               See "How to run the dashboard" below.
  Dockerfile                 - multi-stage: builds the Vite app, then serves dist/ with nginx (see "Docker")
  nginx.conf                  - SPA fallback (try_files ... /index.html) so a hard refresh on a
                               client-routed path like /playground doesn't 404
  src/
    main.jsx, App.jsx       - entry point; App owns the admin key (in memory only), the active nav tab,
                               and the mobile sidebar-drawer open/close state
    api.js                  - fetch wrapper: base URL from VITE_API_URL, always sends x-admin-key; also
                               has getHealth() (calls the public GET /health, no admin key) for the
                               sidebar's connection dot, and getCacheStats() for the Cache page
    index.css               - Tailwind v4 `@theme` design tokens as real CSS custom properties
                               (--color-bg, --color-surface, --color-accent, --color-series-1..8, etc.);
                               [data-theme="dark"] overrides the same properties, so every Tailwind
                               utility and every chart (which reads colors via var(...)) repaints on
                               toggle with no re-render needed
    lib/
      format.js              - formatNumber/formatPercent/formatUsd/formatLatency/formatRelativeTime
      chartTheme.js           - shared Recharts colors/tooltip styling (CSS var references)
      badgeTone.js             - maps backend enums (circuit state, request status, cache type) to a
                               Badge tone (good/warn/bad/neutral/accent)
    hooks/
      usePolling.js           - fetch now + every 10s; also tracks lastUpdated for the top bar
      useTheme.js              - light/dark toggle, persisted to localStorage, sets <html data-theme>
      useRoute.js               - the minimal client-side router (Stage 7, Part 4): path<->tab lookup
                               table + history.pushState/popstate; navigate() accepts either a bare tab
                               name (sidebar) or a real path+query string (Playground -> Request Flow)
      useRememberedApiKey.js    - optional sessionStorage persistence for Playground's gateway key only
                               (unchecked by default); never used for provider keys or the admin key
    components/
      Login.jsx               - asks for the admin key, verifies it with one real API call before logging in
      layout/Sidebar.jsx       - nav, connection status dot (polls GET /health), theme toggle, logout;
                               fixed column on desktop, slide-over drawer on mobile
      layout/PageHeader.jsx    - page title, optional range selector, "updated Xs ago", refresh button,
                               mobile hamburger
      common/                  - Badge, StatusBadge, KpiCard, RangeSelector, ProgressBar, CompositionMeter,
                               Skeleton (loading placeholders), EmptyState, ErrorBanner, Modal (Stage 7,
                               Part 5: small reusable centered dialog - backdrop/Escape/X to close)
      charts/                  - RequestsAreaChart, SourceDonutChart, CostBarChart, VerifierBarChart,
                               ProviderSparkline (Recharts, muted CVD-safe categorical palette)
    pages/
      Overview.jsx             - KPIs + the 3 timeseries charts + a recent-requests list
      RequestsPage.jsx         - filterable/paginated log table; row click opens a slide-over detail panel
        requests/RequestFilters.jsx, RequestsTable.jsx, RequestDetailPanel.jsx
      ProvidersPage.jsx        - one card per provider: circuit badge, success-rate bar, recent-latency
                               sparkline (built client-side from the last 50 /v1/admin/logs entries,
                               since /v1/admin/providers itself has no time-bucketed latency series)
      CachePage.jsx            - exact/semantic/miss composition, tokens+cost saved, verifier outcome
                               breakdown, judge cost/latency (from GET /v1/admin/cache-stats)
      ApiKeysPage.jsx          - limits, usage bars, isActive/semanticCacheEnabled toggles, "Create API
                               key" button, per-row delete action (Stage 7, Part 5)
        apikeys/CreateKeyDialog.jsx - two-step dialog: create-key form, then the raw key shown once
                               (Copy button, "Use in Playground") - see Stage 7, Part 5 above
      RequestFlow.jsx          - "Request Flow" page (Stage 7, Part 3): an animated, entirely simulated
                               walkthrough of a request's lifecycle through the gateway - mock/scripted
                               data only, makes no backend calls. See below.
      Playground.jsx           - "Playground" page (Stage 7, Part 4): builds and sends REAL requests to
                               POST /v1/chat and inspects the response - the gateway is the only thing it
                               calls, never Groq/Gemini directly. See below.
    lib/request-flow/
      nodes.js                 - the diagram's fixed node positions + forward connection paths (SVG
                               coordinates); returnPathFrom(nodeId) generates the "drop to a lower lane
                               and go straight back to the Client" shortcut used by cache hits and errors
      paths.js                 - resolveStepPath(step): looks up a travel step's `from`/`to` in the
                               connection registry (walking it backwards for a retry/fallback bounce) or
                               generates a return-lane path when `via: "return"`
      scenarios.js             - all 15 scenarios as pure data (arrays of travel/process/wait steps) built
                               from small composable fragments (authPass, exactHit, semanticMiss, etc.) -
                               adding a scenario is adding data here, not touching the engine or components
      useFlowSimulation.js     - the simulation engine: a requestAnimationFrame loop used as a pausable,
                               speed-aware clock for every step type. Only "travel" steps use the per-frame
                               progress for anything visual (moving the packet) - respects
                               prefers-reduced-motion by snapping travel progress straight to 1 instead of
                               animating it (so nodes still highlight step-by-step, just without motion)
    components/request-flow/
      FlowCanvas.jsx            - lays out the SVG (connections + the traveling packet) under the
                               absolutely-positioned node cards at matching coordinates; fixed pixel size,
                               not percentage-scaled, so cards never crowd on a narrow screen - the page
                               wraps it in a horizontal-scroll container instead of a second mobile layout
      FlowNode.jsx               - one node card: status badge, a filling progress bar while "active" (not
                               an SVG ring - a ring stretched badly inside a wide-short card), a brief
                               shake + inline error callout on "error"
      RequestPacket.jsx          - the traveling packet: an invisible geometry `<path>` (for
                               getPointAtLength) plus a visible foreground path that line-draws in behind
                               it (stroke-dasharray/dashoffset), and the packet marker itself (glowing dot
                               for request/chunk, a pill for response)
      ProviderNode.jsx, CacheNode.jsx, VerifierSteps.jsx, CircuitBreakerIndicator.jsx - specialized
                               FlowNode wrappers for Groq/Gemini, Exact/Semantic Cache, the semantic-cache
                               verifier mini-stepper, and the circuit breaker state badge
      ScenarioSelector.jsx, RequestTimeline.jsx, FlowMetrics.jsx - the top toolbar (scenario dropdown,
                               Run/Pause/Replay, speed) and the two right-side panels
    lib/playground/
      sendRequest.js            - sendPlainRequest/sendStreamingRequest: thin fetch() wrappers for
                               POST /v1/chat. Streaming re-implements public/stream-test.html's parsing
                               (fetch + a manual reader, since EventSource can't POST); both normalize
                               network/CORS failures into one readable message (the two are genuinely
                               indistinguishable from JS - see the function's comment)
      mapScenario.js            - mapScenarioId(): picks the Request Flow scenario id that matches what a
                               real response actually showed (status/cacheType/verifierResult/attempts/
                               headers) - never guesses at the two cases a single response can't reveal
                               (circuit-open; see the file's comment)
      buildFlowSummary.js       - buildFlowSummary(): the "✓ Auth ✓ Rate limit ✕ Exact cache MISS …"
                               checklist, built the same evidence-only way as mapScenario.js
      mask.js                   - maskSecret(): masks the gateway API key for display (Headers table,
                               history) - never used for the value actually sent
    components/playground/
      RequestBar.jsx            - method badge, editable endpoint, Send/Stop (mutually exclusive), Reset
      AuthSection.jsx           - the gateway API key input, masked with a show/hide toggle
      HeadersEditor.jsx         - editable header rows; the Authorization row's value always mirrors the
                               API key field (masked), swapped for the real key only at send time
      JsonEditor.jsx            - the body textarea with a scroll-synced line-number gutter, Format/Clear
      ExampleChips.jsx          - quick-fill prompts (Normal/Repeat last/Paraphrase/Opposite) for fast demos
      AdvancedOptions.jsx       - Stream/Bypass checkboxes, plus a read-only semantic-cache-status readout
                               (from the X-Semantic-Cache header) - deliberately not a checkbox, since
                               semantic caching is a per-key/global setting, not a per-request one
      ResponsePanel.jsx, ResponseTabs.jsx - status line + CacheBanner, then Response/Raw/Headers/Metadata
                               tabs; every field is shown only if the response actually has it
      CacheBanner.jsx           - the HIT-EXACT/HIT-SEMANTIC/MISS/BYPASS/rejected-candidate banner
      RequestMetrics.jsx        - a KpiCard grid built only from fields present on the response
      FlowSummary.jsx           - renders buildFlowSummary.js's checklist + "View Full Request Flow ->"
      RequestHistory.jsx        - in-memory list (no backend endpoint); "Re-send" replays the exact
                               request snapshot that was sent, not whatever the editor currently has
```

### Known UI limitations (would need a backend change, not made here)
- KPI cards on Overview don't show a "vs. previous period" ↑/↓ indicator - `/v1/admin/overview` only
  returns the selected range, not the prior equal-length window to diff against. Would need either a
  `previous: {...}` block in that same response or a `?compare=true` flag.
- The API Keys page shows `requestsPerMinute` as a plain limit, not a live progress bar - `/v1/admin/keys`
  only reports `requestsToday` (a daily total), which isn't comparable to a per-minute cap. Would need the
  endpoint to also expose the current-minute count from the same Redis counter `rateLimit.service.js`
  already uses to enforce that limit.

## How to run the dashboard
```bash
npm run install:dashboard   # once, from the repo root
npm run dev                 # backend, in one terminal
npm run dev:dashboard       # dashboard, in another terminal - http://localhost:5173
```
Log in with the `ADMIN_API_KEY` value from `.env`. The dashboard calls the backend directly (`VITE_API_URL` in `dashboard/.env`, default `http://localhost:3000`) - CORS on the backend is what allows this cross-origin browser call to succeed. **Open the dashboard at `http://localhost:5173`, not `http://127.0.0.1:5173`** - `DASHBOARD_ORIGIN` is matched by exact origin string, and the two hosts count as different origins even though they resolve to the same machine.
