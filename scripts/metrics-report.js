// Run with: node scripts/metrics-report.js (or: npm run metrics)
//
// Prints a resume-ready metrics summary for the gateway and saves it to
// docs/metrics.md. Five independent sections:
//
//   1. Latency    - 20 new prompts (provider call), the same 20 repeated
//                   (exact cache hit), and 20 paraphrases of a second set of
//                   20 (semantic cache hit) - median latencyMs each, sent as
//                   real HTTP requests into the gateway with providers
//                   mocked in-process (same mocks tests/helpers/mockProviders.js
//                   uses - no real vendor calls, no quota spent).
//   2. Semantic cache eval (test split) - wrong-hit rate and hit rate for
//                   embeddings-only / +antonym guard / +guard+judge, reusing
//                   the tune-then-report-on-test methodology from
//                   scripts/evalSemanticCache.js. This section calls the
//                   REAL Gemini embedding API and the real primary provider
//                   (the judge) - same as `npm run eval-cache` already does.
//   3. PII eval   - precision/recall per type + overall (scripts/piiEvalSet.json,
//                   deterministic, no network) plus average time to mask one case.
//   4. Test count - runs the real test suite (same files `npm test` runs) in
//                   a child process and reports how many tests ran/passed.
//   5. Fallback   - Groq forced to fail (400, not retried), median time until
//                   Gemini answers, across several fresh trials (fresh circuit
//                   breaker + caches each trial, via a Redis flush).
//
// Needs a reachable MongoDB + Redis Stack instance, same as `npm test` (see
// CLAUDE.md "How to run tests"). Section 2 additionally needs real
// GEMINI_API_KEY/GROQ_API_KEY values in .env (not the dummy test ones) - it
// will still run with dummy keys, it just won't score any pairs.
//
// NODE_ENV is set to "test" on the very next line, before any project file
// is imported. Everything that needs src/config/env.js is loaded with a
// dynamic import() AFTER that, deliberately - a static import here would be
// hoisted and evaluated before this assignment runs (ES module semantics),
// which would leave env.js reading an unset NODE_ENV and pointing this
// script at the real dev Mongo/Redis instead of the isolated test ones.
process.env.NODE_ENV = "test";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { performance } from "perf_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const RUN_ID = Date.now();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmtMs(ms) {
  return ms === null ? "N/A" : `${ms.toFixed(1)}ms`;
}

function fmtPct(fraction) {
  return fraction === null ? "N/A" : `${(fraction * 100).toFixed(1)}%`;
}

function printTable(title, headers, rows) {
  console.log(`\n${title}`);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(" | ");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
  for (const row of rows) console.log(line(row));
}

function mdTable(headers, rows) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [headerLine, sepLine, ...bodyLines].join("\n");
}

// --- Section 1: Latency ---------------------------------------------------
async function runLatencyBenchmark(ctx) {
  const { baseUrl, createApiKey, resetAllMocks, cleanTestDb, ensureSemanticIndex, providers, env, mockEmbeddingSuccess, createDeterministicVector } = ctx;

  await cleanTestDb();
  try {
    await ensureSemanticIndex();
  } catch {
    // Non-fatal - if SEMANTIC_CACHE_ENABLED is off, the index just won't be used.
  }
  resetAllMocks();

  const { rawKey } = await createApiKey({
    name: `metrics-latency-${RUN_ID}`,
    requestsPerMinute: 1_000_000,
    tokensPerDay: 1_000_000_000,
    semanticCacheEnabled: true,
  });

  // A short, randomized delay stands in for a real provider round-trip -
  // mocks otherwise resolve near-instantly, which would make "provider call"
  // vs "cache hit" latency indistinguishable in the report.
  providers.groq = async () => {
    await sleep(50 + Math.random() * 150);
    return { text: "Mocked gateway answer for metrics.", inputTokens: 12, outputTokens: 24, model: env.GROQ_MODEL };
  };

  // This key has semanticCacheEnabled on, so EVERY request that misses the
  // exact cache (all of 1a, and the seed half of 1c) also runs the semantic
  // lookup - which calls embed(). That has to be mocked for the whole
  // section, not just for 1c's paraphrases: left real, it would (a) make
  // "provider call" latency mostly measure a real Gemini network round-trip
  // instead of the injected mock delay, and (b) burn the same free-tier
  // embedding quota section 2 needs. A #N# tag shares a vector across a
  // seed/paraphrase pair (so they can match); anything else gets a seed
  // derived from its own text, so distinct fresh prompts never collide.
  mockEmbeddingSuccess((text) => {
    const tagged = text.match(/#(\d+)#/);
    if (tagged) return createDeterministicVector(Number(tagged[1]));
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return createDeterministicVector(1000 + (hash % 100000));
  });

  async function send(prompt) {
    const res = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    return { cache: res.headers.get("x-cache"), data };
  }

  // 1a. 20 unique prompts -> always a full miss -> provider call.
  const providerLatencies = [];
  const freshPrompts = [];
  for (let i = 0; i < 20; i++) {
    const prompt = `Metrics benchmark fresh prompt ${RUN_ID}-${i}: tell me something unique about topic ${i}.`;
    freshPrompts.push(prompt);
    const { data } = await send(prompt);
    if (typeof data.latencyMs === "number") providerLatencies.push(data.latencyMs);
  }

  // 1b. The exact same 20 prompts again -> exact cache hit.
  const exactHitLatencies = [];
  for (const prompt of freshPrompts) {
    const { data } = await send(prompt);
    if (typeof data.latencyMs === "number") exactHitLatencies.push(data.latencyMs);
  }

  // 1c. 20 seed prompts (provider call, not measured) + 20 paraphrases of
  // them (semantic cache hit, if semantic caching is active for this key).
  // Wording differs enough between a seed and its paraphrase that the exact
  // cache always misses on the paraphrase - it can only be a semantic hit.
  const semanticHitLatencies = [];
  for (let i = 0; i < 20; i++) {
    const seedPrompt = `Please describe #${i}# in detail: topic number ${i}.`;
    const paraphrase = `Could you explain #${i}# thoroughly: topic number ${i}.`;
    await send(seedPrompt);
    const { cache, data } = await send(paraphrase);
    if (cache === "HIT-SEMANTIC" && typeof data.latencyMs === "number") {
      semanticHitLatencies.push(data.latencyMs);
    }
  }

  resetAllMocks();
  await cleanTestDb();

  return {
    providerCall: median(providerLatencies),
    exactHit: median(exactHitLatencies),
    semanticHit: median(semanticHitLatencies),
    samples: { providerCall: providerLatencies.length, exactHit: exactHitLatencies.length, semanticHit: semanticHitLatencies.length },
  };
}

// --- Section 2: Semantic cache eval (test split) ---------------------------
async function runSemanticCacheEval(ctx) {
  const { embed, antonymGuard, hasEntityDifference, llmJudge, env, resetAllMocks } = ctx;
  resetAllMocks(); // make sure embed()/llmJudge() hit the real configured APIs, not a leftover mock

  const THRESHOLDS = [0.85, 0.88, 0.9, 0.92, 0.95];

  function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  const pairs = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "semanticCacheEvalSet.json"), "utf-8"));

  const scored = [];
  for (const pair of pairs) {
    const [embA, embB] = await Promise.all([embed(pair.promptA), embed(pair.promptB)]);
    if (!embA || !embB) continue;

    const similarity = cosineSimilarity(embA, embB);
    const antonymResult = antonymGuard(pair.promptA, pair.promptB);
    const entityDifference = hasEntityDifference(pair.promptA, pair.promptB);

    let judgeAccepted = false;
    if (antonymResult.accepted) {
      const judgeResult = await llmJudge(pair.promptA, pair.promptB);
      judgeAccepted = judgeResult.accepted;
    }

    scored.push({ ...pair, similarity, antonymAccepted: antonymResult.accepted, entityDifference, judgeAccepted });
  }

  function scoreMode(rows, threshold, decide) {
    let correctHits = 0, wrongHits = 0;
    for (const row of rows) {
      const matched = decide(row, threshold);
      if (row.shouldMatch && matched) correctHits++;
      else if (!row.shouldMatch && matched) wrongHits++;
    }
    const shouldMatchCount = rows.filter((r) => r.shouldMatch).length;
    const shouldNotMatchCount = rows.length - shouldMatchCount;
    return {
      hitRate: shouldMatchCount === 0 ? null : correctHits / shouldMatchCount,
      wrongHitRate: shouldNotMatchCount === 0 ? null : wrongHits / shouldNotMatchCount,
    };
  }

  function evaluateMode(decide) {
    const tuneRows = scored.filter((r) => r.split === "tune");
    const testRows = scored.filter((r) => r.split === "test");
    if (tuneRows.length === 0 || testRows.length === 0) {
      return { threshold: null, hitRate: null, wrongHitRate: null };
    }

    let best = null;
    for (const threshold of THRESHOLDS) {
      // Tune for the lowest wrong-hit rate first (that's the one that
      // matters for safety), then the highest hit rate as a tie-breaker.
      const result = scoreMode(tuneRows, threshold, decide);
      const wrongHitRate = result.wrongHitRate ?? 0;
      const hitRate = result.hitRate ?? 0;
      if (!best || wrongHitRate < best.wrongHitRate || (wrongHitRate === best.wrongHitRate && hitRate > best.hitRate)) {
        best = { threshold, wrongHitRate, hitRate };
      }
    }

    const testResult = scoreMode(testRows, best.threshold, decide);
    return { threshold: best.threshold, ...testResult };
  }

  const mode1 = evaluateMode((row, t) => row.similarity >= t);
  const mode2 = evaluateMode((row, t) => row.similarity >= t && row.antonymAccepted);
  const mode3 = evaluateMode((row, t) => {
    if (row.similarity < t || !row.antonymAccepted) return false;
    const skipJudge = row.similarity >= env.JUDGE_SKIP_ABOVE && !row.entityDifference;
    return skipJudge ? true : row.judgeAccepted;
  });

  return { mode1, mode2, mode3, scoredCount: scored.length, totalPairs: pairs.length };
}

// --- Section 3: PII eval ----------------------------------------------------
async function runPiiEval(ctx) {
  const { detectAll, createRedactionSession, PII_TYPES } = ctx;
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "piiEvalSet.json"), "utf-8"));

  const stats = {};
  for (const type of PII_TYPES) stats[type] = { tp: 0, fp: 0, fn: 0 };

  let totalDurationMs = 0;
  for (const testCase of cases) {
    const expected = new Set(testCase.expectedTypes);
    const detected = new Set(detectAll(testCase.text).map((m) => m.type));

    for (const type of PII_TYPES) {
      const shouldHave = expected.has(type);
      const didHave = detected.has(type);
      if (shouldHave && didHave) stats[type].tp++;
      else if (!shouldHave && didHave) stats[type].fp++;
      else if (shouldHave && !didHave) stats[type].fn++;
    }

    const session = createRedactionSession(PII_TYPES);
    const start = performance.now();
    session.mask(testCase.text);
    totalDurationMs += performance.now() - start;
  }

  let totalTp = 0, totalFp = 0, totalFn = 0;
  const perType = {};
  for (const type of PII_TYPES) {
    const { tp, fp, fn } = stats[type];
    totalTp += tp;
    totalFp += fp;
    totalFn += fn;
    perType[type] = {
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    };
  }

  return {
    perType,
    overallPrecision: totalTp + totalFp === 0 ? 1 : totalTp / (totalTp + totalFp),
    overallRecall: totalTp + totalFn === 0 ? 1 : totalTp / (totalTp + totalFn),
    avgRedactionMs: totalDurationMs / cases.length,
    caseCount: cases.length,
  };
}

// --- Section 4: Test count --------------------------------------------------
function runTestCount() {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "tests/unit/**/*.test.js", "tests/integration/**/*.test.js", "tests/pii.route.test.js"],
    { cwd: ROOT, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
  );

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const testsMatch = output.match(/# tests (\d+)/);
  const passMatch = output.match(/# pass (\d+)/);
  const failMatch = output.match(/# fail (\d+)/);

  return {
    tests: testsMatch ? Number(testsMatch[1]) : null,
    pass: passMatch ? Number(passMatch[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
  };
}

// --- Section 5: Fallback -----------------------------------------------------
async function runFallbackBenchmark(ctx) {
  const { baseUrl, createApiKey, mockProviderError, resetAllMocks, cleanTestDb, providers, env } = ctx;
  const TRIALS = 10;
  const latencies = [];

  for (let i = 0; i < TRIALS; i++) {
    // Fresh circuit breaker + caches each trial, so every trial genuinely
    // attempts Groq first instead of the breaker short-circuiting it after
    // the first few failures.
    await cleanTestDb();
    resetAllMocks();

    mockProviderError("groq", 400, "Simulated Groq outage (forced for metrics)");
    providers.gemini = async () => {
      await sleep(50 + Math.random() * 150);
      return { text: "Gemini answered after forced Groq failure.", inputTokens: 10, outputTokens: 18, model: env.GEMINI_MODEL };
    };

    const { rawKey } = await createApiKey({
      name: `metrics-fallback-${RUN_ID}-${i}`,
      requestsPerMinute: 1_000_000,
      tokensPerDay: 1_000_000_000,
    });

    const res = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ prompt: `Metrics fallback trial ${RUN_ID}-${i}: tell me a short fact.` }),
    });
    const data = await res.json();

    if (res.status === 200 && data.fallbackUsed && data.provider === "gemini" && typeof data.latencyMs === "number") {
      latencies.push(data.latencyMs);
    }
  }

  resetAllMocks();
  await cleanTestDb();

  return { median: median(latencies), trials: TRIALS, successfulTrials: latencies.length };
}

// --- Report assembly --------------------------------------------------------
function printAndBuildReport({ latency, semanticEval, piiEval, testCount, fallback }) {
  const generatedAt = new Date().toISOString();
  const md = [];
  md.push("# LLM Gateway - Metrics Report");
  md.push("");
  md.push(`Generated ${generatedAt} by \`npm run metrics\` (scripts/metrics-report.js).`);
  md.push("");

  // --- 1. Latency ---
  const latencyHeaders = ["Path", "Median latency", "Samples"];
  const latencyRows = [
    ["Provider call (full miss)", fmtMs(latency.providerCall), latency.samples.providerCall],
    ["Exact cache hit", fmtMs(latency.exactHit), latency.samples.exactHit],
    ["Semantic cache hit", fmtMs(latency.semanticHit), latency.samples.semanticHit],
  ];
  printTable("1. Latency (20 new prompts, 20 repeated, 20 paraphrases)", latencyHeaders, latencyRows);
  md.push("## 1. Latency");
  md.push("");
  md.push(
    "20 new prompts (provider call), the same 20 repeated (exact cache hit), and 20 paraphrases of a second " +
      "set of 20 (semantic cache hit) - sent as real HTTP requests into the gateway with providers mocked " +
      "in-process (a randomized 50-200ms delay stands in for a real provider round-trip)."
  );
  md.push("");
  md.push(mdTable(latencyHeaders, latencyRows));
  md.push("");

  // --- 2. Semantic cache eval ---
  const semHeaders = ["Mode", "Threshold", "Hit rate", "Wrong-hit rate"];
  const semRows = [
    ["1. Embeddings only", semanticEval.mode1.threshold ?? "N/A", fmtPct(semanticEval.mode1.hitRate), fmtPct(semanticEval.mode1.wrongHitRate)],
    ["2. + antonym guard", semanticEval.mode2.threshold ?? "N/A", fmtPct(semanticEval.mode2.hitRate), fmtPct(semanticEval.mode2.wrongHitRate)],
    ["3. + antonym guard + judge", semanticEval.mode3.threshold ?? "N/A", fmtPct(semanticEval.mode3.hitRate), fmtPct(semanticEval.mode3.wrongHitRate)],
  ];
  printTable(
    `2. Semantic cache eval - test split (${semanticEval.scoredCount}/${semanticEval.totalPairs} pairs scored)`,
    semHeaders,
    semRows
  );
  md.push("## 2. Semantic cache eval (held-out test split)");
  md.push("");
  md.push(
    `${semanticEval.scoredCount}/${semanticEval.totalPairs} pairs scored (the rest skipped on an embedding API ` +
      "error, e.g. a free-tier quota hit). Threshold per mode is chosen on the tune split (lowest wrong-hit rate, " +
      "then highest hit rate), then reported on the held-out test split - see scripts/evalSemanticCache.js."
  );
  md.push("");
  md.push(mdTable(semHeaders, semRows));
  md.push("");

  // --- 3. PII eval ---
  const piiHeaders = ["Type", "Precision", "Recall"];
  const piiRows = Object.entries(piiEval.perType).map(([type, { precision, recall }]) => [
    type,
    fmtPct(precision),
    fmtPct(recall),
  ]);
  piiRows.push(["Overall", fmtPct(piiEval.overallPrecision), fmtPct(piiEval.overallRecall)]);
  printTable(`3. PII eval (${piiEval.caseCount} cases, avg redaction time ${piiEval.avgRedactionMs.toFixed(4)}ms)`, piiHeaders, piiRows);
  md.push("## 3. PII eval");
  md.push("");
  md.push(`${piiEval.caseCount} cases from scripts/piiEvalSet.json. Average time to mask one case: **${piiEval.avgRedactionMs.toFixed(4)}ms**.`);
  md.push("");
  md.push(mdTable(piiHeaders, piiRows));
  md.push("");

  // --- 4. Test count ---
  const testHeaders = ["Tests", "Passed", "Failed"];
  const testRows = [[testCount.tests ?? "N/A", testCount.pass ?? "N/A", testCount.fail ?? "N/A"]];
  printTable("4. Test count (node --test, unit + integration)", testHeaders, testRows);
  md.push("## 4. Test count");
  md.push("");
  md.push("Same files `npm test` runs (`tests/unit/**/*.test.js`, `tests/integration/**/*.test.js`, `tests/pii.route.test.js`).");
  md.push("");
  md.push(mdTable(testHeaders, testRows));
  md.push("");

  // --- 5. Fallback ---
  const fallbackHeaders = ["Median time to Gemini answer", "Successful trials"];
  const fallbackRows = [[fmtMs(fallback.median), `${fallback.successfulTrials}/${fallback.trials}`]];
  printTable("5. Fallback (Groq forced to fail with 400, not retried)", fallbackHeaders, fallbackRows);
  md.push("## 5. Fallback");
  md.push("");
  md.push(
    `Groq forced to fail (400, not retried - immediate switch to Gemini) across ${fallback.trials} fresh trials ` +
      "(circuit breaker + caches reset between trials). Median end-to-end latency until Gemini's answer comes back."
  );
  md.push("");
  md.push(mdTable(fallbackHeaders, fallbackRows));
  md.push("");

  return md.join("\n");
}

// --- Main --------------------------------------------------------------------
async function main() {
  console.log("Running test count (spawns the real test suite - this may take a bit)...");
  const testCount = runTestCount();

  const testDb = await import("../tests/helpers/testDb.js");
  const apiKeyService = await import("../src/services/apiKey.service.js");
  const mockProviders = await import("../tests/helpers/mockProviders.js");
  const envModule = await import("../src/config/env.js");
  const embeddingService = await import("../src/services/embedding.service.js");
  const cacheVerifierService = await import("../src/services/cacheVerifier.service.js");
  const semanticCacheService = await import("../src/services/semanticCache.service.js");
  const providersModule = await import("../src/services/providers/index.js");
  const detectorsModule = await import("../src/services/pii/detectors.js");
  const redactorModule = await import("../src/services/pii/redactor.js");
  const piiTypesModule = await import("../src/config/piiTypes.js");

  const ctx = {
    createApiKey: apiKeyService.createApiKey,
    ...mockProviders,
    env: envModule.env,
    embed: embeddingService.embed,
    antonymGuard: cacheVerifierService.antonymGuard,
    hasEntityDifference: cacheVerifierService.hasEntityDifference,
    llmJudge: cacheVerifierService.llmJudge,
    ensureSemanticIndex: semanticCacheService.ensureSemanticIndex,
    providers: providersModule.providers,
    detectAll: detectorsModule.detectAll,
    createRedactionSession: redactorModule.createRedactionSession,
    PII_TYPES: piiTypesModule.PII_TYPES,
  };

  console.log("PII eval (deterministic, no network)...");
  const piiEval = await runPiiEval(ctx);

  console.log("Starting test environment (Mongo + Redis + the app)...");
  const { baseUrl } = await testDb.setupTestEnvironment();
  ctx.baseUrl = baseUrl;
  ctx.cleanTestDb = testDb.cleanTestDb;

  let latency;
  let fallback;
  let semanticEval;

  try {
    console.log("Latency benchmark (mocked providers)...");
    latency = await runLatencyBenchmark(ctx);

    console.log("Fallback benchmark (Groq forced to fail)...");
    fallback = await runFallbackBenchmark(ctx);

    console.log("Semantic cache eval (real embedding + judge calls - this may take a minute)...");
    semanticEval = await runSemanticCacheEval(ctx);
  } finally {
    await testDb.teardownTestEnvironment();
  }

  const report = printAndBuildReport({ latency, semanticEval, piiEval, testCount, fallback });

  const docsDir = path.join(ROOT, "docs");
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "metrics.md"), report + "\n");
  console.log("\nSaved docs/metrics.md");
}

main().catch((error) => {
  console.error("Metrics report failed:", error);
  process.exit(1);
});
