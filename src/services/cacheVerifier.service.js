// Double-checks a semantic cache candidate before trusting it. Embedding
// similarity alone can score an opposite-meaning question ("lock a file"
// vs "unlock a file") or a same-template-different-topic question
// ("capital of France" vs "capital of Spain") as high as a genuine
// paraphrase - see the eval. This runs up to three checks, in order, ONLY
// when a candidate has already cleared SIMILARITY_THRESHOLD:
//   1. Antonym guard (instant, no API call) - catches wording-level opposites.
//   2. Judge-skip zone (instant) - a candidate this similar, with no entity
//      difference, is trusted outright without spending a judge call.
//   3. LLM judge (one short provider call, cached in Redis) - catches
//      everything else, e.g. same question structure about a different thing.
// A rejection at any step is treated as "not a real match" - never a
// broken request, just a fallback to a normal provider call.
import crypto from "crypto";
import { env } from "../config/env.js";
import { ANTONYM_PAIRS } from "../config/antonyms.js";
import { TECH_TERMS } from "../config/techTerms.js";
import { providers } from "./providers/index.js";
import { getPrimaryProvider } from "./router.service.js";
import { redis } from "../config/redis.js";
import { normalizePrompt } from "./cache.service.js";
import { calculateCost } from "./cost.service.js";

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

const ANTONYM_SET = new Set(ANTONYM_PAIRS.map(([a, b]) => pairKey(a, b)));

function isAntonymPair(a, b) {
  if (ANTONYM_SET.has(pairKey(a, b))) return true;
  // "un-"/"dis-" prefix pairs (lock/unlock, enable/disable) are opposites
  // automatically - no need to list every one of these by hand.
  if (a === `un${b}` || b === `un${a}`) return true;
  if (a === `dis${b}` || b === `dis${a}`) return true;
  return false;
}

// Lowercases, strips punctuation, and splits into words.
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Same, but keeps original casing - needed to spot capitalized proper nouns.
function tokenizeKeepCase(text) {
  return text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function differingWords(tokensA, tokensB) {
  const setA = new Set(tokensA.map((w) => w.toLowerCase()));
  const setB = new Set(tokensB.map((w) => w.toLowerCase()));
  return {
    onlyInA: tokensA.filter((w) => !setB.has(w.toLowerCase())),
    onlyInB: tokensB.filter((w) => !setA.has(w.toLowerCase())),
  };
}

// Instant, no API call. Rejects when the words unique to each prompt
// contain an antonym pair, or when the two prompts mention different numbers
// (e.g. "top 5 ..." vs "top 10 ...").
export function antonymGuard(promptA, promptB) {
  const tokensA = tokenize(promptA);
  const tokensB = tokenize(promptB);
  const { onlyInA, onlyInB } = differingWords(tokensA, tokensB);

  for (const a of onlyInA) {
    for (const b of onlyInB) {
      if (isAntonymPair(a, b)) {
        return { accepted: false, reason: `antonym: ${a}/${b}` };
      }
    }
  }

  const numbersA = new Set(tokensA.filter((word) => /\d/.test(word)));
  const numbersB = new Set(tokensB.filter((word) => /\d/.test(word)));
  const sameNumbers =
    numbersA.size === numbersB.size && [...numbersA].every((n) => numbersB.has(n));

  if (!sameNumbers) {
    return {
      accepted: false,
      reason: `different numbers: ${[...numbersA].join(",") || "none"} vs ${[...numbersB].join(",") || "none"}`,
    };
  }

  return { accepted: true, reason: "antonym-guard: no conflict" };
}

// True if the words unique to each prompt include a capitalized word, a
// known programming language/framework, or a known product/platform name -
// e.g. "France"/"Spain", "Python"/"Java", "React"/"Vue". Pairs like this
// often score deceptively high on embedding similarity (same sentence
// template) despite needing a completely different answer, so they always
// go to the judge regardless of JUDGE_SKIP_ABOVE.
//
// The first word of each prompt is excluded from the capitalization check
// (but NOT from the tech-term check) - English capitalizes the start of a
// sentence regardless of content, so "What" vs "Can" would otherwise look
// like an entity difference when it's really just two different question words.
export function hasEntityDifference(promptA, promptB) {
  const tokensA = tokenizeKeepCase(promptA);
  const tokensB = tokenizeKeepCase(promptB);
  const lowerA = new Set(tokensA.map((w) => w.toLowerCase()));
  const lowerB = new Set(tokensB.map((w) => w.toLowerCase()));

  const candidates = [
    ...tokensA
      .map((word, index) => ({ word, index }))
      .filter(({ word }) => !lowerB.has(word.toLowerCase())),
    ...tokensB
      .map((word, index) => ({ word, index }))
      .filter(({ word }) => !lowerA.has(word.toLowerCase())),
  ];

  return candidates.some(({ word, index }) => {
    if (TECH_TERMS.has(word.toLowerCase())) return true;
    if (index === 0) return false;
    return /^[A-Z]/.test(word);
  });
}

function judgeCacheKey(promptA, promptB) {
  const normalized = [normalizePrompt(promptA), normalizePrompt(promptB)].sort();
  const hash = crypto.createHash("sha256").update(normalized.join("|")).digest("hex");
  return `judge:${hash}`;
}

// One short provider call: "do these two questions require the same
// answer?" Safe default on any failure/timeout is NO - we'd rather miss a
// real cache hit than silently serve the wrong answer. Decisions are cached
// in Redis (same TTL as the answer caches, keyed by both prompts regardless
// of order) so the same pair is never judged twice.
export async function llmJudge(promptA, promptB) {
  if (!env.SEMANTIC_JUDGE_ENABLED) {
    return { accepted: true, reason: "accepted (judge disabled)", inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const cacheKey = judgeCacheKey(promptA, promptB);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    const { accepted, reason } = JSON.parse(cached);
    return { accepted, reason, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const judgePrompt =
    `Question 1: "${promptA}"\n` +
    `Question 2: "${promptB}"\n\n` +
    `Do these two questions require the same answer? Reply with only YES or NO.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.JUDGE_TIMEOUT_MS);

  try {
    const askPrimary = providers[getPrimaryProvider()];
    const result = await askPrimary(judgePrompt, controller.signal);
    const answer = result.text.trim().toUpperCase();

    const accepted = answer.startsWith("YES");
    const reason = accepted ? "accepted" : "judge: NO";
    const costUsd = calculateCost(result.model, result.inputTokens, result.outputTokens);

    await redis
      .set(cacheKey, JSON.stringify({ accepted, reason }), "EX", env.CACHE_TTL_SECONDS)
      .catch(() => {});

    return { accepted, reason, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd };
  } catch (error) {
    return {
      accepted: false,
      reason: `judge: failed, defaulting to NO (${error.message})`,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Runs the full verification pipeline for a semantic candidate. `similarity`
// is the candidate's embedding similarity score, used only for the
// judge-skip-zone decision. Returns enough detail to both decide the
// request's fate and log exactly what happened:
//   { accepted, reason, outcome, judgeUsed, judgeInputTokens,
//     judgeOutputTokens, judgeCostUsd, judgeLatencyMs }
// `outcome` is one of "rejected_by_guard", "accepted_high_similarity",
// "accepted_by_judge", "rejected_by_judge" - a stable value for stats,
// separate from `reason`'s human-readable detail.
export async function verifyCandidate(promptA, promptB, similarity) {
  const antonymResult = antonymGuard(promptA, promptB);
  if (!antonymResult.accepted) {
    return {
      accepted: false,
      reason: antonymResult.reason,
      outcome: "rejected_by_guard",
      judgeUsed: false,
      judgeInputTokens: 0,
      judgeOutputTokens: 0,
      judgeCostUsd: 0,
      judgeLatencyMs: 0,
    };
  }

  const skipJudge = similarity >= env.JUDGE_SKIP_ABOVE && !hasEntityDifference(promptA, promptB);

  if (skipJudge) {
    return {
      accepted: true,
      reason: "accepted (similarity above judge-skip threshold)",
      outcome: "accepted_high_similarity",
      judgeUsed: false,
      judgeInputTokens: 0,
      judgeOutputTokens: 0,
      judgeCostUsd: 0,
      judgeLatencyMs: 0,
    };
  }

  const judgeStart = Date.now();
  const judgeResult = await llmJudge(promptA, promptB);
  const judgeLatencyMs = Date.now() - judgeStart;

  return {
    accepted: judgeResult.accepted,
    reason: judgeResult.reason,
    outcome: judgeResult.accepted ? "accepted_by_judge" : "rejected_by_judge",
    judgeUsed: true,
    judgeInputTokens: judgeResult.inputTokens,
    judgeOutputTokens: judgeResult.outputTokens,
    judgeCostUsd: judgeResult.costUsd,
    judgeLatencyMs,
  };
}
