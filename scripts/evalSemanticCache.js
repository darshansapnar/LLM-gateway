// Run with: node scripts/evalSemanticCache.js (or: npm run eval-cache)
//
// Measures how well different SIMILARITY_THRESHOLD values separate
// genuinely-same-meaning prompt pairs ("should match") from pairs that
// should NOT match - antonym-style ("start"/"stop") and same-template-
// different-topic ("capital of France" vs "capital of Spain") - using the
// actual embedding model this gateway uses.
//
// Each pair in semanticCacheEvalSet.json has a "split": "tune" or "test".
// For every mode, the best threshold is chosen using ONLY the tune split,
// then that threshold's real-world accuracy is reported on the held-out
// test split - the same tune/test discipline as any other ML evaluation,
// so the final numbers aren't just the threshold that happened to fit this
// exact data best.
//
// Reports three modes, mirroring the real pipeline in chat.routes.js /
// cacheVerifier.service.js:
//   1. embeddings only           - just the cosine-similarity threshold
//   2. + antonym guard           - also rejects wording-level opposites
//   3. + antonym guard + judge   - also asks the primary provider to confirm,
//                                  respecting the real JUDGE_SKIP_ABOVE zone
//                                  and entity check (same code path, imported
//                                  from cacheVerifier.service.js)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../src/config/env.js";
import { embed } from "../src/services/embedding.service.js";
import { antonymGuard, hasEntityDifference, llmJudge } from "../src/services/cacheVerifier.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THRESHOLDS = [0.85, 0.88, 0.9, 0.92, 0.95];

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Computes, once per pair, everything every mode/threshold combination
// needs: similarity, the antonym verdict, the entity-difference flag, and
// (only if the antonym guard accepts - exactly like the real pipeline)
// the judge's verdict.
async function scorePair(pair) {
  const [embA, embB] = await Promise.all([embed(pair.promptA), embed(pair.promptB)]);
  if (!embA || !embB) {
    return null;
  }

  const similarity = cosineSimilarity(embA, embB);
  const antonymResult = antonymGuard(pair.promptA, pair.promptB);
  const entityDifference = hasEntityDifference(pair.promptA, pair.promptB);

  let judgeAccepted = false;
  if (antonymResult.accepted) {
    const judgeResult = await llmJudge(pair.promptA, pair.promptB);
    judgeAccepted = judgeResult.accepted;
  }

  return {
    ...pair,
    similarity,
    antonymAccepted: antonymResult.accepted,
    antonymReason: antonymResult.reason,
    hasEntityDifference: entityDifference,
    judgeAccepted,
  };
}

// `decide(row, threshold)` returns { matched, usedJudge } for one mode.
function scoreMode(rows, threshold, decide) {
  let correctHits = 0;
  let wrongHits = 0;
  let missedHits = 0;
  let correctRejections = 0;
  let judgeCalls = 0;

  for (const row of rows) {
    const { matched, usedJudge } = decide(row, threshold);
    if (usedJudge) judgeCalls++;

    if (row.shouldMatch && matched) correctHits++;
    else if (!row.shouldMatch && matched) wrongHits++;
    else if (row.shouldMatch && !matched) missedHits++;
    else correctRejections++;
  }

  const accuracy = rows.length === 0 ? 0 : (correctHits + correctRejections) / rows.length;
  const shouldNotMatchCount = rows.filter((row) => !row.shouldMatch).length;
  const wrongHitRate = shouldNotMatchCount === 0 ? 0 : wrongHits / shouldNotMatchCount;

  return { correctHits, wrongHits, missedHits, accuracy, wrongHitRate, judgeCalls };
}

function formatRow(threshold, result) {
  return (
    `  ${threshold.toFixed(2)}    |      ${result.correctHits}       |     ${result.wrongHits}      |      ${result.missedHits}      |  ` +
    `${(result.accuracy * 100).toFixed(1)}%   |  ${(result.wrongHitRate * 100).toFixed(1)}%        |     ${result.judgeCalls}`
  );
}

// Sweeps all thresholds on the TUNE split to pick the best one, then
// reports that threshold's numbers on the held-out TEST split.
function evaluateMode(title, scored, decide) {
  const tuneRows = scored.filter((row) => row.split === "tune");
  const testRows = scored.filter((row) => row.split === "test");

  console.log(`\n--- Mode: ${title} ---`);
  console.log(`Tuning on the TUNE split (${tuneRows.length} pairs):`);
  console.log("Threshold | Correct Hits | Wrong Hits | Missed Hits | Accuracy | Wrong-Hit Rate | Judge Calls");
  console.log("----------|--------------|------------|-------------|----------|----------------|------------");

  let best = null;
  for (const threshold of THRESHOLDS) {
    const result = scoreMode(tuneRows, threshold, decide);
    console.log(formatRow(threshold, result));

    if (
      !best ||
      result.accuracy > best.result.accuracy ||
      (result.accuracy === best.result.accuracy && result.wrongHits < best.result.wrongHits)
    ) {
      best = { threshold, result };
    }
  }

  console.log(`Chosen threshold (from tune split): ${best.threshold}`);

  const testResult = scoreMode(testRows, best.threshold, decide);
  console.log(
    `TEST split (${testRows.length} pairs) @ threshold ${best.threshold}: ` +
      `correct=${testResult.correctHits} wrong=${testResult.wrongHits} missed=${testResult.missedHits} ` +
      `accuracy=${(testResult.accuracy * 100).toFixed(1)}% wrongHitRate=${(testResult.wrongHitRate * 100).toFixed(1)}% ` +
      `judgeCalls=${testResult.judgeCalls}`
  );

  return { threshold: best.threshold, testResult };
}

async function main() {
  const testSetPath = path.join(__dirname, "semanticCacheEvalSet.json");
  const pairs = JSON.parse(fs.readFileSync(testSetPath, "utf-8"));

  console.log(`Scoring ${pairs.length} pairs (embeddings + antonym guard + LLM judge where applicable)...\n`);

  const scored = [];
  for (const pair of pairs) {
    const row = await scorePair(pair);
    if (!row) {
      console.warn(`Skipping pair (embedding failed): "${pair.promptA}" / "${pair.promptB}"`);
      continue;
    }
    scored.push(row);
  }

  console.log("Per-pair results:");
  for (const row of scored) {
    console.log(
      `  [${row.split}]  sim=${row.similarity.toFixed(4)}  antonym=${row.antonymAccepted ? "pass" : "REJECT"}  ` +
        `entityDiff=${row.hasEntityDifference}  judge=${row.judgeAccepted ? "pass" : "reject"}  ` +
        `shouldMatch=${String(row.shouldMatch).padEnd(5)}  "${row.promptA}" <-> "${row.promptB}"` +
        (row.antonymAccepted ? "" : `  [${row.antonymReason}]`)
    );
  }

  const mode1 = evaluateMode("1. embeddings only", scored, (row, threshold) => ({
    matched: row.similarity >= threshold,
    usedJudge: false,
  }));

  const mode2 = evaluateMode("2. embeddings + antonym guard", scored, (row, threshold) => ({
    matched: row.similarity >= threshold && row.antonymAccepted,
    usedJudge: false,
  }));

  const mode3 = evaluateMode(
    "3. embeddings + antonym guard + LLM judge (incl. judge-skip zone + entity check)",
    scored,
    (row, threshold) => {
      if (row.similarity < threshold || !row.antonymAccepted) {
        return { matched: false, usedJudge: false };
      }
      const skipJudge = row.similarity >= env.JUDGE_SKIP_ABOVE && !row.hasEntityDifference;
      if (skipJudge) {
        return { matched: true, usedJudge: false };
      }
      return { matched: row.judgeAccepted, usedJudge: true };
    }
  );

  console.log("\n=== Summary (TEST split, threshold chosen from TUNE split) ===");
  for (const [name, mode] of [
    ["Mode 1 (embeddings only)", mode1],
    ["Mode 2 (+ antonym guard)", mode2],
    ["Mode 3 (+ antonym guard + judge)", mode3],
  ]) {
    console.log(
      `${name}: threshold=${mode.threshold}  accuracy=${(mode.testResult.accuracy * 100).toFixed(1)}%  ` +
        `wrongHitRate=${(mode.testResult.wrongHitRate * 100).toFixed(1)}%  judgeCalls=${mode.testResult.judgeCalls}`
    );
  }
}

main().catch((error) => {
  console.error("Eval failed:", error.message);
  process.exit(1);
});
