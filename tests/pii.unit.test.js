// Pure unit tests for the PII redaction pipeline's building blocks - no
// network, no DB, no Redis. Covers:
//   - checksums.js: Luhn (card) and Verhoeff (Aadhaar)
//   - detectors.js: each detector individually, plus overlap priority
//     (CARD beats PHONE_IN when a card number contains a phone-shaped span)
//   - redactor.js: mask/restore round-trip, placeholder reuse, and the
//     stream restorer's chunk-boundary buffering
import { test } from "node:test";
import assert from "node:assert/strict";
import { luhnValid, verhoeffValid } from "../src/services/pii/checksums.js";
import {
  detectEmail,
  detectPhoneIn,
  detectCard,
  detectAadhaar,
  detectPan,
  detectSecret,
  detectAll,
} from "../src/services/pii/detectors.js";
import { createRedactionSession, restore, createStreamRestorer } from "../src/services/pii/redactor.js";

// --- checksums.js --------------------------------------------------------

test("luhnValid accepts a real test card number and rejects a tweaked one", () => {
  // Standard Visa test card number (Luhn-valid by construction).
  assert.equal(luhnValid("4111111111111111"), true);
  // Flip the last digit - breaks the checksum.
  assert.equal(luhnValid("4111111111111112"), false);
});

// Verhoeff has no well-known "test number" the way Luhn does, so we derive
// a valid one: for any 11-digit prefix, exactly one trailing digit (0-9)
// makes the checksum valid (Verhoeff is a single-check-digit scheme).
function makeValidVerhoeff(prefix11) {
  for (let d = 0; d <= 9; d++) {
    const candidate = prefix11 + String(d);
    if (verhoeffValid(candidate)) return candidate;
  }
  throw new Error("no valid check digit found - prefix or table is wrong");
}

test("verhoeffValid accepts a derived valid number and rejects every other last digit", () => {
  const prefix = "23456789012"; // 11 digits, arbitrary
  const valid = makeValidVerhoeff(prefix);
  assert.equal(verhoeffValid(valid), true);

  const validLastDigit = Number(valid[11]);
  for (let d = 0; d <= 9; d++) {
    if (d === validLastDigit) continue;
    assert.equal(verhoeffValid(prefix + String(d)), false, `digit ${d} should not also be valid`);
  }
});

// --- detectors.js ----------------------------------------------------------

test("detectEmail finds an email address", () => {
  const found = detectEmail("contact me at jane.doe@example.com please");
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "EMAIL");
});

test("detectPhoneIn finds an Indian mobile number with and without +91", () => {
  const found = detectPhoneIn("call +91 98765 43210 or 9876543210 today");
  assert.equal(found.length, 2);
  assert.ok(found.every((m) => m.type === "PHONE_IN"));
});

test("detectPhoneIn does not match a number starting with a digit outside 6-9", () => {
  // Indian mobiles always start 6-9; this is a 10-digit number starting with 5.
  const found = detectPhoneIn("reference number 5123456789 on file");
  assert.equal(found.length, 0);
});

test("detectCard finds a Luhn-valid card number and ignores a same-length non-Luhn number", () => {
  const validFound = detectCard("pay with 4111 1111 1111 1111 now");
  assert.equal(validFound.length, 1);
  assert.equal(validFound[0].type, "CARD");

  // Same shape (16 digits, grouped by 4), but not Luhn-valid - e.g. an order ID.
  const invalidFound = detectCard("order id 1234 5678 9012 3458 confirmed");
  assert.equal(invalidFound.length, 0);
});

test("detectAadhaar finds a Verhoeff-valid 12-digit number not starting with 0/1", () => {
  const valid = makeValidVerhoeff("23456789012");
  const found = detectAadhaar(`my aadhaar is ${valid} thanks`);
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "AADHAAR");
});

test("detectAadhaar rejects a 12-digit number starting with 0 or 1 even if checksum-shaped", () => {
  // UIDAI never issues Aadhaar numbers starting with 0 or 1.
  const found = detectAadhaar("id 012345678901 on file");
  assert.equal(found.length, 0);
});

test("detectPan finds a PAN-shaped token", () => {
  const found = detectPan("PAN: ABCDE1234F for verification");
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "PAN");
});

test("detectSecret finds provider-prefixed keys and key=value style secrets", () => {
  const found = detectSecret('token sk-abcdefghij1234567890 and password: "sup3rSecret!"');
  assert.equal(found.length, 2);
  assert.ok(found.every((m) => m.type === "SECRET"));
});

test("detectAll gives CARD priority over PHONE_IN when a card number contains a phone-shaped span", () => {
  // 6011111111111117 is a Luhn-valid Discover test card number. Grouped as
  // "6011111111-111117", its first 10 (contiguous) digits also look like an
  // Indian mobile number (starts 6-9) on their own, with the dash right
  // after satisfying PHONE_IN's "not followed by another digit" guard.
  const text = "card on file: 6011111111-111117, please charge it";

  const cardMatches = detectCard(text);
  const phoneMatches = detectPhoneIn(text);
  assert.equal(cardMatches.length, 1, "setup: should find the card");
  assert.equal(phoneMatches.length, 1, "setup: should find the embedded phone-shaped span");
  assert.ok(
    phoneMatches[0].start >= cardMatches[0].start && phoneMatches[0].end <= cardMatches[0].end,
    "setup: the phone match should sit inside the card match"
  );

  const resolved = detectAll(text, ["CARD", "AADHAAR", "PAN", "SECRET", "EMAIL", "PHONE_IN"]);
  assert.equal(resolved.length, 1, "only the CARD match should survive overlap resolution");
  assert.equal(resolved[0].type, "CARD");
});

// --- redactor.js -----------------------------------------------------------

test("createRedactionSession masks and restore() reverses it exactly", () => {
  const session = createRedactionSession(["EMAIL"]);
  const masked = session.mask("reach jane@example.com for details");
  assert.ok(!masked.includes("jane@example.com"));
  assert.match(masked, /\[EMAIL_1\]/);

  const restored = restore(masked, session.mapping);
  assert.equal(restored, "reach jane@example.com for details");
});

test("the same real value reuses the same placeholder across prompt and answer", () => {
  const session = createRedactionSession(["EMAIL"]);
  const maskedPrompt = session.mask("my email is jane@example.com");
  const maskedAnswer = session.mask("ok, I noted jane@example.com as your email");

  assert.match(maskedPrompt, /\[EMAIL_1\]/);
  assert.match(maskedAnswer, /\[EMAIL_1\]/);
  assert.equal(Object.keys(session.mapping).length, 1, "one real value should map to one placeholder");
});

test("restore() leaves a placeholder not in the mapping untouched", () => {
  // Simulates a cache hit built by a DIFFERENT caller's session - this
  // caller's own (empty) mapping must never fill in someone else's value.
  const result = restore("your code is [EMAIL_1]", {});
  assert.equal(result, "your code is [EMAIL_1]");
});

test("createStreamRestorer restores a placeholder split across two chunks", () => {
  const session = createRedactionSession(["EMAIL"]);
  session.mask("jane@example.com"); // populates the mapping with EMAIL_1 -> jane@example.com

  const restorer = createStreamRestorer(session.mapping);
  let output = "";
  // The placeholder "[EMAIL_1]" is split mid-token across two deltas.
  output += restorer.process("Your email on file is [EMA");
  output += restorer.process("IL_1], thanks for confirming");
  output += restorer.flush();

  assert.equal(output, "Your email on file is jane@example.com, thanks for confirming");
  assert.ok(!output.includes("[EMA"), "no half-placeholder should ever have been emitted");
});

test("createStreamRestorer flush() emits a trailing unmatched bracket as-is", () => {
  const restorer = createStreamRestorer({});
  let output = restorer.process("no placeholder here, just a stray [ bracket");
  output += restorer.flush();
  assert.equal(output, "no placeholder here, just a stray [ bracket");
});
