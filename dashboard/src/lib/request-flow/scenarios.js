// Every scenario is pure data: a list of steps. The engine
// (useFlowSimulation.js) doesn't know anything about "Groq" or "401" - it
// just executes whatever steps a scenario gives it. Adding a new scenario
// later means adding an entry to SCENARIOS below; no component or engine
// change required.
//
// Step shapes:
//   travel  { type:"travel", from, to, via?, duration, packet, state, timeline?, metrics? }
//     Moves the packet from node `from` to node `to`. `via:"return"` uses
//     the return-lane shortcut instead of the forward topology. `packet`
//     is "request" | "response" | "chunk". `state` colors the packet/path:
//     "neutral" | "success" | "error" | "retry".
//   process { type:"process", node, status, duration, timeline?, metrics?, detail?, parentNode? }
//     Pauses the packet at `node` (or, if `parentNode` is set, advances a
//     semantic-cache verifier sub-step without moving the main packet) and
//     shows a progress ring for `duration`. `status` is the node's
//     resulting visual state: "active" | "success" | "error" | "skipped" |
//     "hit" | "miss".
//   wait   { type:"wait", node, duration, label, timeline? }
//     A backoff/cooldown countdown shown at `node`, no packet movement.
//
// All durations are milliseconds at 1x speed. `timeline` (a string) and
// `metrics` (a partial object merged into the live metrics panel) may
// appear on any step type and are applied when that step resolves.

const GROQ_MODEL = "openai/gpt-oss-120b";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

const travel = (from, to, opts = {}) => ({
  type: "travel",
  from,
  to,
  via: opts.via,
  duration: opts.duration ?? 500,
  packet: opts.packet ?? "request",
  state: opts.state ?? "neutral",
  timeline: opts.timeline,
  metrics: opts.metrics,
});

const proc = (node, opts = {}) => ({
  type: "process",
  node,
  parentNode: opts.parentNode,
  status: opts.status ?? "active",
  duration: opts.duration ?? 450,
  timeline: opts.timeline,
  metrics: opts.metrics,
  detail: opts.detail,
});

const wait = (node, opts = {}) => ({
  type: "wait",
  node,
  duration: opts.duration ?? 300,
  label: opts.label ?? "Waiting…",
  timeline: opts.timeline,
});

// ---- Shared fragments (every scenario starts with auth + rate limit) ----

function authPass() {
  return [
    travel("client", "auth", { duration: 500 }),
    proc("auth", {
      status: "success",
      duration: 400,
      timeline: "API key authenticated",
      metrics: { status: "in progress" },
      detail: { lines: ["✓ Authenticated", "Key prefix: gw_7f2a…"] },
    }),
  ];
}

function authFail() {
  return [
    travel("client", "auth", { duration: 500 }),
    proc("auth", {
      status: "error",
      duration: 450,
      timeline: "Invalid API key — 401 Unauthorized",
      metrics: { status: "error · 401" },
      detail: { lines: ["✕ Invalid API Key", "Key prefix: gw_bad1…", "401 Unauthorized"] },
    }),
    travel("auth", "client", {
      via: "return",
      packet: "response",
      state: "error",
      duration: 450,
      timeline: "401 response returned to client",
    }),
  ];
}

function rateLimitPass() {
  return [
    travel("auth", "ratelimit", { duration: 450 }),
    proc("ratelimit", {
      status: "success",
      duration: 400,
      timeline: "Rate limit passed (18 / 20 requests this minute)",
      detail: {
        lines: [
          "18 / 20 requests this minute",
          "12,430 / 50,000 tokens today",
          "Requests counted before the call; tokens added after the response",
        ],
      },
    }),
  ];
}

function rateLimitFail() {
  return [
    travel("auth", "ratelimit", { duration: 450 }),
    proc("ratelimit", {
      status: "error",
      duration: 450,
      timeline: "Rate limit exceeded — 429 Too Many Requests",
      metrics: { status: "error · 429" },
      detail: { lines: ["20 / 20 requests this minute", "✕ Exceeded", "429 Too Many Requests"] },
    }),
    travel("ratelimit", "client", {
      via: "return",
      packet: "response",
      state: "error",
      duration: 450,
      timeline: "429 response returned to client",
    }),
  ];
}

function exactMiss() {
  return [
    travel("ratelimit", "exactcache", { duration: 420 }),
    proc("exactcache", {
      status: "miss",
      duration: 350,
      timeline: "Exact cache MISS",
      metrics: { cacheType: "none" },
      detail: { lines: ["Redis GET: no match", "Continuing to semantic cache"] },
    }),
  ];
}

function exactHit({ latencyMs = 2, tokensSaved = 126 } = {}) {
  return [
    travel("ratelimit", "exactcache", { duration: 420 }),
    proc("exactcache", {
      status: "hit",
      duration: 320,
      timeline: "Exact cache HIT",
      metrics: { cacheType: "exact", status: "success", latencyMs, costUsd: 0, tokensSaved },
      detail: { lines: [`Latency: ${latencyMs}ms`, `Tokens saved: ${tokensSaved}`] },
    }),
    travel("exactcache", "client", {
      via: "return",
      packet: "response",
      state: "success",
      duration: 500,
      timeline: "Cached response returned to client (exact match)",
    }),
  ];
}

function exactBypassed() {
  return [
    travel("ratelimit", "exactcache", { duration: 420 }),
    proc("exactcache", {
      status: "skipped",
      duration: 300,
      timeline: "Exact cache read BYPASSED (x-cache-bypass: true)",
      detail: { lines: ["Cache read: BYPASSED", "A fresh answer will still be written afterward"] },
    }),
  ];
}

function semanticEnterActive(lines) {
  return proc("semanticcache", {
    status: "active",
    duration: 200,
    timeline: "Checking semantic cache…",
    detail: { lines },
  });
}

// `globalOn`/`keyOn` drive the two status lines so they can never
// contradict each other; `note` overrides the second line for a skip
// reason that isn't one of those two flags (e.g. conversation history).
function semanticSkipped({ globalOn = true, keyOn = true, note } = {}) {
  const secondLine = note ?? `API key semantic cache: ${keyOn ? "ON" : "OFF"}`;
  const reasonLabel = note ?? (!globalOn ? "global semantic cache off" : "API key not opted in");
  return [
    travel("exactcache", "semanticcache", { duration: 420 }),
    proc("semanticcache", {
      status: "skipped",
      duration: 350,
      timeline: `Semantic cache SKIPPED (${reasonLabel})`,
      metrics: { cacheType: "none" },
      detail: { lines: [`Global semantic cache: ${globalOn ? "ON" : "OFF"}`, secondLine] },
    }),
    travel("semanticcache", "router", { duration: 420 }),
  ];
}

function semanticMiss() {
  return [
    travel("exactcache", "semanticcache", { duration: 420 }),
    semanticEnterActive(["Global semantic cache: ON", "API key semantic cache: ON"]),
    proc("embed", { parentNode: "semanticcache", status: "success", duration: 280, timeline: "Embedding generated" }),
    proc("vectorsearch", {
      parentNode: "semanticcache",
      status: "success",
      duration: 260,
      timeline: "Vector search — no candidate ≥ 0.90",
    }),
    proc("semanticcache", {
      status: "miss",
      duration: 220,
      timeline: "Semantic cache MISS",
      metrics: { cacheType: "none" },
    }),
    travel("semanticcache", "router", { duration: 420 }),
  ];
}

function semanticHitNoJudge() {
  return [
    travel("exactcache", "semanticcache", { duration: 420 }),
    semanticEnterActive(["Global semantic cache: ON", "API key semantic cache: ON"]),
    proc("embed", { parentNode: "semanticcache", status: "success", duration: 260, timeline: "Embedding generated" }),
    proc("vectorsearch", {
      parentNode: "semanticcache",
      status: "success",
      duration: 240,
      timeline: "Vector search found 1 candidate",
    }),
    proc("similarity", {
      parentNode: "semanticcache",
      status: "success",
      duration: 220,
      timeline: "Similarity 0.98 (≥ 0.90 candidate bar)",
      metrics: { similarity: 0.98 },
    }),
    proc("guard", { parentNode: "semanticcache", status: "success", duration: 200, timeline: "Antonym guard passed" }),
    proc("entity", { parentNode: "semanticcache", status: "success", duration: 200, timeline: "No entity difference" }),
    proc("judge", {
      parentNode: "semanticcache",
      status: "skipped",
      duration: 180,
      timeline: "Similarity ≥ 0.97 — accepted without judge",
      metrics: { judgeUsed: false, verifierResult: "accepted_high_similarity" },
    }),
    proc("semanticcache", {
      status: "hit",
      duration: 260,
      timeline: "Semantic cache HIT",
      metrics: { cacheType: "semantic", status: "success" },
      detail: { lines: ['Matched: "What is machine learning?"', "Accepted without judge"] },
    }),
    travel("semanticcache", "client", {
      via: "return",
      packet: "response",
      state: "success",
      duration: 500,
      timeline: "Cached response returned to client (semantic match)",
    }),
  ];
}

function semanticRejectedByGuard() {
  return [
    travel("exactcache", "semanticcache", { duration: 420 }),
    semanticEnterActive(["Global semantic cache: ON", "API key semantic cache: ON"]),
    proc("embed", { parentNode: "semanticcache", status: "success", duration: 260, timeline: "Embedding generated" }),
    proc("vectorsearch", {
      parentNode: "semanticcache",
      status: "success",
      duration: 240,
      timeline: "Vector search found 1 candidate",
    }),
    proc("similarity", {
      parentNode: "semanticcache",
      status: "success",
      duration: 220,
      timeline: "Similarity 0.955 (candidate)",
      metrics: { similarity: 0.955 },
    }),
    proc("guard", {
      parentNode: "semanticcache",
      status: "error",
      duration: 320,
      timeline: "Antonym guard REJECTED (on/off)",
      metrics: { verifierResult: "rejected_by_guard" },
      detail: {
        lines: [
          'Prompt: "How do I turn off dark mode in VS Code?"',
          'Matched: "How do I turn on dark mode in VS Code?"',
          "Rejected: antonym pair on/off",
        ],
      },
    }),
    proc("semanticcache", {
      status: "miss",
      duration: 220,
      timeline: "Treated as a miss — continuing to the provider",
      metrics: { cacheType: "none" },
    }),
    travel("semanticcache", "router", { duration: 420 }),
  ];
}

function semanticAcceptedByJudge() {
  return [
    travel("exactcache", "semanticcache", { duration: 420 }),
    semanticEnterActive(["Global semantic cache: ON", "API key semantic cache: ON"]),
    proc("embed", { parentNode: "semanticcache", status: "success", duration: 260, timeline: "Embedding generated" }),
    proc("vectorsearch", {
      parentNode: "semanticcache",
      status: "success",
      duration: 240,
      timeline: "Vector search found 1 candidate",
    }),
    proc("similarity", {
      parentNode: "semanticcache",
      status: "success",
      duration: 220,
      timeline: "Similarity 0.93 (below the 0.97 judge-skip bar)",
      metrics: { similarity: 0.93 },
    }),
    proc("guard", { parentNode: "semanticcache", status: "success", duration: 200, timeline: "Antonym guard passed" }),
    proc("entity", { parentNode: "semanticcache", status: "success", duration: 200, timeline: "No entity difference" }),
    proc("judge", {
      parentNode: "semanticcache",
      status: "active",
      duration: 300,
      timeline: "Asking the judge: do these need the same answer?",
    }),
    proc("judge", {
      parentNode: "semanticcache",
      status: "success",
      duration: 100,
      timeline: "Judge: YES — same question",
      metrics: {
        judgeUsed: true,
        judgeLatencyMs: 300,
        judgeCostUsd: 0.0000006,
        verifierResult: "accepted_by_judge",
      },
    }),
    proc("semanticcache", {
      status: "hit",
      duration: 260,
      timeline: "Semantic cache HIT (accepted by judge)",
      metrics: { cacheType: "semantic", status: "success" },
      detail: { lines: ['Matched: "Can you define machine learning?"', "Accepted by judge"] },
    }),
    travel("semanticcache", "client", {
      via: "return",
      packet: "response",
      state: "success",
      duration: 500,
      timeline: "Cached response returned to client (judge-verified)",
    }),
  ];
}

function semanticBypassed() {
  return [
    travel("exactcache", "semanticcache", { duration: 420 }),
    proc("semanticcache", {
      status: "skipped",
      duration: 300,
      timeline: "Semantic cache read BYPASSED (x-cache-bypass: true)",
      detail: { lines: ["Cache read: BYPASSED", "A fresh answer will still be written afterward"] },
    }),
    travel("semanticcache", "router", { duration: 420 }),
  ];
}

function routeAndGroqSuccess({ attempt = 1, latencyMs = 842, inputTokens = 74, outputTokens = 118, costUsd = 0.00014 } = {}) {
  return [
    proc("router", {
      status: "success",
      duration: 280,
      timeline: `Routing to Groq (attempt ${attempt})`,
      detail: { lines: ["Order: 1. Groq, 2. Gemini", `Provider: Groq`, `Model: ${GROQ_MODEL}`, `Attempt: ${attempt}`] },
    }),
    travel("router", "groq", { duration: 500 }),
    proc("groq", {
      status: "success",
      duration: 900,
      timeline: "Groq responded successfully",
      metrics: {
        provider: "groq",
        model: GROQ_MODEL,
        latencyMs,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd,
        status: "success",
        cacheType: "none",
      },
      detail: { lines: ["Groq ✓", `${latencyMs}ms`] },
    }),
    travel("groq", "response", { packet: "response", state: "success", duration: 350 }),
  ];
}

function respondAndLog({ extraDetail = [] } = {}) {
  return [
    proc("response", {
      status: "success",
      duration: 260,
      timeline: "Response generated",
      detail: { lines: ["See Live Metrics →", ...extraDetail] },
    }),
    travel("response", "cachelog", { duration: 300 }),
    proc("cachelog", {
      status: "success",
      duration: 450,
      timeline: "Stored in exact + semantic cache; request logged",
      detail: {
        lines: [
          "Store in exact + semantic cache",
          "Request Log (MongoDB): provider, model, tokens, latency, cacheType, cost, status, timestamp",
        ],
      },
    }),
    travel("cachelog", "client", {
      via: "return",
      packet: "response",
      state: "success",
      duration: 520,
      timeline: "Response delivered to client",
    }),
  ];
}

// ---- Scenarios ----

export const SCENARIOS = [
  {
    id: "normal",
    label: "Normal Request",
    description: "Full miss → Groq → cached + logged.",
    steps: [...authPass(), ...rateLimitPass(), ...exactMiss(), ...semanticMiss(), ...routeAndGroqSuccess(), ...respondAndLog()],
  },
  {
    id: "exact-hit",
    label: "Exact Cache Hit",
    description: "Identical prompt already cached — shortest possible trip.",
    steps: [...authPass(), ...rateLimitPass(), ...exactHit()],
  },
  {
    id: "exact-miss",
    label: "Exact Cache Miss",
    description: "No exact match; semantic cache is skipped this time, straight to Groq.",
    steps: [
      ...authPass(),
      ...rateLimitPass(),
      ...exactMiss(),
      ...semanticSkipped({ keyOn: false }),
      ...routeAndGroqSuccess({ latencyMs: 611, inputTokens: 58, outputTokens: 94, costUsd: 0.00011 }),
      ...respondAndLog(),
    ],
  },
  {
    id: "semantic-hit",
    label: "Semantic Cache Hit",
    description: "High similarity (0.98) — accepted without calling the judge.",
    steps: [...authPass(), ...rateLimitPass(), ...exactMiss(), ...semanticHitNoJudge()],
  },
  {
    id: "semantic-miss",
    label: "Semantic Cache Miss",
    description: "No candidate clears the 0.90 similarity bar — on to the provider.",
    steps: [...authPass(), ...rateLimitPass(), ...exactMiss(), ...semanticMiss(), ...routeAndGroqSuccess(), ...respondAndLog()],
  },
  {
    id: "semantic-skipped",
    label: "Semantic Cache Skipped",
    description: "This API key hasn't opted in to semantic caching.",
    steps: [
      ...authPass(),
      ...rateLimitPass(),
      ...exactMiss(),
      ...semanticSkipped({ keyOn: false }),
      ...routeAndGroqSuccess(),
      ...respondAndLog(),
    ],
  },
  {
    id: "semantic-guard-rejected",
    label: "Semantic Rejected by Guard",
    description: '"turn off dark mode" vs. cached "turn on dark mode" — an antonym, not a match.',
    steps: [...authPass(), ...rateLimitPass(), ...exactMiss(), ...semanticRejectedByGuard(), ...routeAndGroqSuccess(), ...respondAndLog()],
  },
  {
    id: "semantic-judge-accepted",
    label: "Semantic Accepted by Judge",
    description: "Similarity 0.93 — guard passes, judge confirms it's the same question.",
    steps: [...authPass(), ...rateLimitPass(), ...exactMiss(), ...semanticAcceptedByJudge()],
  },
  {
    id: "invalid-key",
    label: "Invalid API Key",
    description: "Auth fails immediately — 401, flow stops.",
    steps: [...authFail()],
  },
  {
    id: "rate-limited",
    label: "Rate Limit Exceeded",
    description: "20/20 requests this minute already used — 429, flow stops.",
    steps: [...authPass(), ...rateLimitFail()],
  },
  {
    id: "groq-retry",
    label: "Groq Retry",
    description: "Groq fails with a retryable error, backs off 300ms, retries, succeeds.",
    steps: [
      ...authPass(),
      ...rateLimitPass(),
      ...exactMiss(),
      ...semanticSkipped({ globalOn: false }),
      proc("router", {
        status: "success",
        duration: 260,
        timeline: "Routing to Groq (attempt 1)",
        detail: { lines: ["Order: 1. Groq, 2. Gemini", `Model: ${GROQ_MODEL}`] },
      }),
      travel("router", "groq", { duration: 480 }),
      proc("groq", {
        status: "error",
        duration: 500,
        timeline: "Groq failed — 503 Service Unavailable (retryable)",
        detail: { lines: ["Groq ✕", "503 Service Unavailable", "400/401 are never retried"] },
      }),
      travel("groq", "router", { state: "retry", duration: 380 }),
      wait("router", { duration: 300, label: "Backoff 300ms…", timeline: "Waiting 300ms before retry (exponential backoff)" }),
      proc("router", { status: "success", duration: 200, timeline: "Retry #1 → Groq", detail: { lines: ["Attempt 2 of 3"] } }),
      travel("router", "groq", { state: "retry", duration: 480 }),
      proc("groq", {
        status: "success",
        duration: 760,
        timeline: "Groq responded successfully (retry succeeded)",
        metrics: {
          provider: "groq",
          model: GROQ_MODEL,
          latencyMs: 1540,
          inputTokens: 74,
          outputTokens: 118,
          totalTokens: 192,
          costUsd: 0.00014,
          status: "success",
          cacheType: "none",
        },
        detail: { lines: ["Groq ✓ (attempt 2)"] },
      }),
      travel("groq", "response", { packet: "response", state: "success", duration: 350 }),
      ...respondAndLog({ extraDetail: ["Retries used: 1"] }),
    ],
  },
  {
    id: "fallback",
    label: "Provider Fallback",
    description: "Groq exhausts its retries, the router falls back to Gemini.",
    steps: [
      ...authPass(),
      ...rateLimitPass(),
      ...exactMiss(),
      ...semanticSkipped({ globalOn: false }),
      proc("router", { status: "success", duration: 260, timeline: "Routing to Groq (attempt 1)" }),
      travel("router", "groq", { duration: 480 }),
      proc("groq", { status: "error", duration: 460, timeline: "Groq failed — timeout", detail: { lines: ["Groq ✕", "Timeout after 15s"] } }),
      travel("groq", "router", { state: "retry", duration: 380 }),
      wait("router", { duration: 300, label: "Backoff 300ms…", timeline: "Waiting 300ms before retry" }),
      proc("router", { status: "success", duration: 200, timeline: "Retry #1 → Groq" }),
      travel("router", "groq", { state: "retry", duration: 480 }),
      proc("groq", {
        status: "error",
        duration: 460,
        timeline: "Groq failed again — retries exhausted",
        detail: { lines: ["Groq ✕ (2 of 2 retries used)"] },
      }),
      travel("groq", "router", { state: "error", duration: 380 }),
      proc("router", {
        status: "success",
        duration: 260,
        timeline: "Falling back to Gemini",
        metrics: { fallbackUsed: true },
        detail: { lines: ["Fallback used: YES", "Groq ✕ ✕  →  Gemini"] },
      }),
      travel("router", "gemini", { duration: 540 }),
      proc("gemini", {
        status: "success",
        duration: 1100,
        timeline: "Gemini responded successfully",
        metrics: {
          provider: "gemini",
          model: GEMINI_MODEL,
          latencyMs: 2380,
          inputTokens: 74,
          outputTokens: 131,
          totalTokens: 205,
          costUsd: 0.00009,
          status: "success",
          cacheType: "none",
          fallbackUsed: true,
        },
        detail: { lines: ["Gemini ✓", "Fallback used: YES"] },
      }),
      travel("gemini", "response", { packet: "response", state: "success", duration: 350 }),
      ...respondAndLog({ extraDetail: ["Attempted: Groq (failed ×2) → Gemini (success)", "Fallback used: YES"] }),
    ],
  },
  {
    id: "circuit-open",
    label: "Circuit Breaker Open",
    description: "3 consecutive Groq failures trip the breaker; Gemini takes over, then the breaker recovers.",
    steps: [
      proc("groq", {
        status: "error",
        duration: 240,
        timeline: "Groq failed (previous request, 1 of 3 consecutive)",
        detail: { lines: ["Prior failure 1 of 3"], circuitState: "CLOSED" },
      }),
      proc("groq", {
        status: "error",
        duration: 240,
        timeline: "Groq failed (previous request, 2 of 3 consecutive)",
        detail: { lines: ["Prior failure 2 of 3"], circuitState: "CLOSED" },
      }),
      proc("groq", {
        status: "error",
        duration: 300,
        timeline: "Groq failed (3 of 3) — circuit breaker OPEN for 30s",
        metrics: { circuitState: "OPEN" },
        detail: { lines: ["Circuit breaker: OPEN", "Cooldown: 30s"], circuitState: "OPEN" },
      }),
      ...authPass(),
      ...rateLimitPass(),
      ...exactMiss(),
      ...semanticSkipped({ globalOn: false }),
      proc("router", {
        status: "success",
        duration: 300,
        timeline: "Groq circuit OPEN — skipping straight to Gemini",
        detail: { lines: ["Groq: OPEN (skipped)", "Routing to Gemini"] },
      }),
      travel("router", "gemini", { duration: 540 }),
      proc("gemini", {
        status: "success",
        duration: 1000,
        timeline: "Gemini responded successfully",
        metrics: {
          provider: "gemini",
          model: GEMINI_MODEL,
          latencyMs: 1920,
          inputTokens: 70,
          outputTokens: 102,
          totalTokens: 172,
          costUsd: 0.00008,
          status: "success",
          cacheType: "none",
        },
        detail: { lines: ["Gemini ✓"] },
      }),
      travel("gemini", "response", { packet: "response", state: "success", duration: 350 }),
      ...respondAndLog({ extraDetail: ["Groq was skipped: circuit OPEN"] }),
      wait("groq", { duration: 450, label: "Cooldown elapsing (simulated)…", timeline: "30s cooldown elapses (fast-forwarded for this demo)" }),
      proc("groq", {
        status: "active",
        duration: 280,
        timeline: "Circuit breaker → HALF-OPEN (one test request allowed)",
        metrics: { circuitState: "HALF_OPEN" },
        detail: { lines: ["Circuit breaker: HALF-OPEN"], circuitState: "HALF_OPEN" },
      }),
      travel("router", "groq", { state: "retry", duration: 420 }),
      proc("groq", {
        status: "success",
        duration: 480,
        timeline: "Test request succeeded — circuit breaker CLOSED",
        metrics: { circuitState: "CLOSED" },
        detail: { lines: ["Circuit breaker: CLOSED", "Groq is back in rotation"], circuitState: "CLOSED" },
      }),
      travel("groq", "router", { state: "success", duration: 350 }),
    ],
  },
  {
    id: "streaming",
    label: "Streaming Request",
    description: "SSE chunks stream back one by one as the client's text box fills in.",
    steps: [
      ...authPass(),
      ...rateLimitPass(),
      ...exactMiss(),
      ...semanticSkipped({ note: "Request has conversation history" }),
      proc("router", { status: "success", duration: 260, timeline: "Routing to Groq (stream: true)" }),
      travel("router", "groq", { duration: 480 }),
      proc("groq", {
        status: "active",
        duration: 300,
        timeline: "Groq stream started — TTFT 184ms",
        metrics: { ttftMs: 184, provider: "groq", model: GROQ_MODEL, cacheType: "none" },
        detail: { lines: ["Stream: SSE", "TTFT: 184ms", "Fallback only possible before the first chunk"] },
      }),
      travel("groq", "client", {
        via: "return",
        packet: "chunk",
        state: "neutral",
        duration: 260,
        timeline: "Chunk 1 / 4 received",
        metrics: { streamAppend: "The capital of France " },
      }),
      travel("groq", "client", {
        via: "return",
        packet: "chunk",
        state: "neutral",
        duration: 260,
        timeline: "Chunk 2 / 4 received",
        metrics: { streamAppend: "is Paris, a global center " },
      }),
      travel("groq", "client", {
        via: "return",
        packet: "chunk",
        state: "neutral",
        duration: 260,
        timeline: "Chunk 3 / 4 received",
        metrics: { streamAppend: "for art, fashion, " },
      }),
      travel("groq", "client", {
        via: "return",
        packet: "chunk",
        state: "success",
        duration: 260,
        timeline: "Chunk 4 / 4 received — stream complete",
        metrics: {
          streamAppend: "and culture.",
          status: "success",
          latencyMs: 1180,
          inputTokens: 68,
          outputTokens: 97,
          totalTokens: 165,
          costUsd: 0.00012,
        },
      }),
      proc("groq", { status: "success", duration: 140, timeline: "Stream complete", detail: { lines: ["Groq ✓", "Stream: SSE"] } }),
      proc("cachelog", {
        status: "success",
        duration: 420,
        timeline: "Completed stream cached + logged (a cancelled stream would log $0)",
        detail: { lines: ["Store in exact + semantic cache", "Request Log (MongoDB)"] },
      }),
    ],
  },
  {
    id: "cache-bypass",
    label: "Cache Bypass",
    description: '"x-cache-bypass: true" skips reading both caches but still writes a fresh answer afterward.',
    steps: [
      ...authPass(),
      ...rateLimitPass(),
      ...exactBypassed(),
      ...semanticBypassed(),
      ...routeAndGroqSuccess(),
      ...respondAndLog({ extraDetail: ["Bypass skips cache reads, not writes"] }),
    ],
  },
];

export const SCENARIOS_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
