// Run with: node scripts/evalPii.js (or: npm run eval-pii)
//
// Measures how well the regex+checksum detectors (src/services/pii/detectors.js)
// separate real PII from text that merely LOOKS like it - using
// scripts/piiEvalSet.json's ~40 hand-written cases: real-looking fake PII
// for every type (EMAIL, PHONE_IN, CARD, AADHAAR, PAN, SECRET), plus tricky
// non-PII the naive version of each regex could be fooled by: order IDs and
// random digit strings that fail Luhn, 12-digit numbers that fail Verhoeff
// (or start with 0/1), dates, prices, and a phone-shaped number starting
// with the wrong digit.
//
// Unlike the semantic cache (embeddings are inherently fuzzy), these
// detectors are deterministic regex + checksum logic - there's no
// threshold to tune, so this script just runs the whole set once and
// reports precision/recall/F1 PER TYPE, plus any individual misses so a
// future regex change that breaks something is caught immediately.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { detectAll } from "../src/services/pii/detectors.js";
import { PII_TYPES } from "../src/config/piiTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCases() {
  const setPath = path.join(__dirname, "piiEvalSet.json");
  return JSON.parse(fs.readFileSync(setPath, "utf-8"));
}

// For one case, returns the distinct set of types detectAll() actually found.
function detectedTypesFor(text) {
  return [...new Set(detectAll(text).map((m) => m.type))];
}

function main() {
  const cases = loadCases();

  // Per-type confusion counts, treating "type T present in this case" as
  // the thing being predicted (type-level, not exact-span) - matches how a
  // caller would experience this: did piiTypes end up containing EMAIL or not.
  const stats = {};
  for (const type of PII_TYPES) {
    stats[type] = { tp: 0, fp: 0, fn: 0 };
  }

  const misses = [];

  for (const testCase of cases) {
    const expected = new Set(testCase.expectedTypes);
    const detected = new Set(detectedTypesFor(testCase.text));

    for (const type of PII_TYPES) {
      const shouldHave = expected.has(type);
      const didHave = detected.has(type);
      if (shouldHave && didHave) stats[type].tp++;
      else if (!shouldHave && didHave) stats[type].fp++;
      else if (shouldHave && !didHave) stats[type].fn++;
      // true negative (neither) isn't tracked - precision/recall don't need it
    }

    const expectedSorted = [...expected].sort();
    const detectedSorted = [...detected].sort();
    const exactMatch = JSON.stringify(expectedSorted) === JSON.stringify(detectedSorted);
    if (!exactMatch) {
      misses.push({ id: testCase.id, text: testCase.text, expected: expectedSorted, detected: detectedSorted });
    }
  }

  console.log(`Scored ${cases.length} cases.\n`);
  console.log("Type       | TP | FP | FN | Precision | Recall | F1");
  console.log("-----------|----|----|----|-----------|--------|------");

  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;

  for (const type of PII_TYPES) {
    const { tp, fp, fn } = stats[type];
    totalTp += tp;
    totalFp += fp;
    totalFn += fn;

    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    console.log(
      `${type.padEnd(10)} | ${String(tp).padStart(2)} | ${String(fp).padStart(2)} | ${String(fn).padStart(2)} | ` +
        `${(precision * 100).toFixed(1).padStart(8)}% | ${(recall * 100).toFixed(1).padStart(5)}% | ${f1.toFixed(2)}`
    );
  }

  const overallPrecision = totalTp + totalFp === 0 ? 1 : totalTp / (totalTp + totalFp);
  const overallRecall = totalTp + totalFn === 0 ? 1 : totalTp / (totalTp + totalFn);
  console.log(
    `\nOverall: precision=${(overallPrecision * 100).toFixed(1)}% recall=${(overallRecall * 100).toFixed(1)}% ` +
      `(${totalTp} true positives, ${totalFp} false positives, ${totalFn} false negatives across ${cases.length} cases)`
  );

  if (misses.length === 0) {
    console.log("\nEvery case matched its expected type set exactly.");
  } else {
    console.log(`\n${misses.length} case(s) did not match expected types exactly:`);
    for (const miss of misses) {
      console.log(`  [${miss.id}] expected=${JSON.stringify(miss.expected)} got=${JSON.stringify(miss.detected)}`);
      console.log(`    "${miss.text}"`);
    }
  }
}

main();
