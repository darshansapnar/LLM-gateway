// Regex-based detectors for the sensitive-data types redactor.js masks.
// Each `detectX(text)` returns an array of { type, start, end } matches
// (character offsets into `text`). detectAll() runs every enabled detector,
// then resolves overlaps so e.g. a 16-digit card number isn't ALSO reported
// as a 10-digit phone number hiding inside it.
//
// This is deliberately regex + checksum based, not a trained model - see
// docs/pii-redaction.md's "Limitations" section for what that does and
// doesn't catch (no names/addresses, only the six structured types below).
import { luhnValid, verhoeffValid } from "./checksums.js";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Indian mobile: optional +91/91/0 prefix, then a digit 6-9 followed by 9
// more digits. Spaces/dashes may appear between any two digits (common
// real-world formatting: "98765 43210", "9876-543-210"). The `(?<!\d)` /
// `(?!\d)` guards stop this from matching a 10-digit slice out of the
// middle of a longer number (a card number, for instance).
const PHONE_IN_REGEX = /(?<!\d)(?:(?:\+91|91|0)[-\s]?)?[6-9](?:[-\s]?\d){9}(?!\d)/g;

// Candidate spans of 13-19 digits (card number lengths), separators
// allowed between digits. Luhn-checked afterwards - a same-length number
// that fails Luhn (e.g. a random order ID) is never reported as a CARD.
const CARD_CANDIDATE_REGEX = /(?<!\d)(?:\d[-\s]?){13,19}(?!\d)/g;

// Aadhaar is always exactly 12 digits. Verhoeff-checked and must not start
// with 0 or 1 (UIDAI never issues those) afterwards.
const AADHAAR_CANDIDATE_REGEX = /(?<!\d)(?:\d[-\s]?){12}(?!\d)/g;

// PAN: five letters, four digits, one letter (e.g. ABCDE1234F). Always
// uppercase in real documents.
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;

// API keys/tokens: known provider prefixes (OpenAI-style sk-..., Groq-style
// gsk_..., AWS AKIA...) or a "key=" / "token:" / "password:" style
// assignment followed by a long-enough value.
const SECRET_REGEX =
  /\bsk-[A-Za-z0-9]{10,}\b|\bgsk_[A-Za-z0-9]{10,}\b|\bAKIA[A-Z0-9]{12,}\b|\b(?:api[_-]?key|apikey|token|secret|password)\s*[:=]\s*['"]?[A-Za-z0-9._-]{6,}['"]?/gi;

function matches(regex, type, text) {
  const found = [];
  for (const m of text.matchAll(regex)) {
    found.push({ type, start: m.index, end: m.index + m[0].length });
  }
  return found;
}

function stripSeparators(raw) {
  return raw.replace(/[-\s]/g, "");
}

export function detectEmail(text) {
  return matches(EMAIL_REGEX, "EMAIL", text);
}

export function detectPhoneIn(text) {
  return matches(PHONE_IN_REGEX, "PHONE_IN", text);
}

export function detectCard(text) {
  const found = [];
  for (const m of text.matchAll(CARD_CANDIDATE_REGEX)) {
    const digits = stripSeparators(m[0]);
    if (digits.length < 13 || digits.length > 19) continue;
    if (!luhnValid(digits)) continue;
    found.push({ type: "CARD", start: m.index, end: m.index + m[0].length });
  }
  return found;
}

export function detectAadhaar(text) {
  const found = [];
  for (const m of text.matchAll(AADHAAR_CANDIDATE_REGEX)) {
    const digits = stripSeparators(m[0]);
    if (digits.length !== 12) continue;
    if (digits[0] === "0" || digits[0] === "1") continue;
    if (!verhoeffValid(digits)) continue;
    found.push({ type: "AADHAAR", start: m.index, end: m.index + m[0].length });
  }
  return found;
}

export function detectPan(text) {
  return matches(PAN_REGEX, "PAN", text);
}

export function detectSecret(text) {
  return matches(SECRET_REGEX, "SECRET", text);
}

const DETECTORS = {
  CARD: detectCard,
  AADHAAR: detectAadhaar,
  PAN: detectPan,
  SECRET: detectSecret,
  EMAIL: detectEmail,
  PHONE_IN: detectPhoneIn,
};

// More specific types win when two matches overlap the same characters -
// e.g. a valid 16-digit card number should never also be reported as the
// 10-digit phone number hiding inside it. Order here IS the priority order
// (first = most specific = wins).
const TYPE_PRIORITY = ["CARD", "AADHAAR", "PAN", "SECRET", "EMAIL", "PHONE_IN"];

function resolveOverlaps(allMatches) {
  const byPriority = [...allMatches].sort(
    (a, b) => TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type)
  );
  const accepted = [];
  for (const candidate of byPriority) {
    const overlaps = accepted.some((a) => candidate.start < a.end && a.start < candidate.end);
    if (!overlaps) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

// Runs every detector in `enabledTypes` (default: all of them) over `text`
// and returns non-overlapping matches sorted left-to-right, ready for
// redactor.js to walk through and replace.
export function detectAll(text, enabledTypes = TYPE_PRIORITY) {
  const allMatches = [];
  for (const type of enabledTypes) {
    const detector = DETECTORS[type];
    if (detector) allMatches.push(...detector(text));
  }
  return resolveOverlaps(allMatches);
}
