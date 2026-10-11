// Masks sensitive data out of text and restores it afterwards. See
// docs/pii-redaction.md for the full flow; the short version:
//
//   session = createRedactionSession(apiKey.piiTypes)
//   maskedPrompt = session.mask(prompt)        // sent to the cache/provider
//   ...call the provider with maskedPrompt...
//   maskedAnswer = session.mask(answer)         // sent to cache/logs
//   clientAnswer = restore(maskedAnswer, session.mapping)   // sent to the caller
//
// `session.mapping` (placeholder -> real value) lives ONLY in memory for the
// lifetime of one request - it is never written to Redis, MongoDB, or
// RequestLog. That's also why a cache HIT is always restored using the
// CURRENT caller's own session (built from masking their own prompt), never
// a mapping saved alongside the cached answer: two different callers whose
// prompts happen to mask to the identical text (e.g. two different emails,
// same question shape) share a cache entry, but each only ever gets their
// OWN real value substituted back in - never someone else's.
import { detectAll } from "./detectors.js";

const PLACEHOLDER_REGEX = /\[[A-Z_]+_\d+\]/g;

export function createRedactionSession(piiTypes) {
  const mapping = {}; // placeholder -> real value, this request only
  const valueToPlaceholder = new Map(); // "TYPE:raw value" -> placeholder, for de-duping repeats
  const seq = {}; // type -> next placeholder number
  const counts = {}; // type -> total occurrences masked this request (prompt + answer)

  // Masks one piece of text (the prompt, or later the answer) against the
  // shared mapping/sequence above, so the SAME real value seen in both the
  // prompt and the answer (the model echoing it back) reuses the SAME
  // placeholder instead of getting a second, different one.
  function mask(text) {
    const found = detectAll(text, piiTypes);
    if (found.length === 0) return text;

    let result = "";
    let cursor = 0;
    for (const m of found) {
      const raw = text.slice(m.start, m.end);
      const dedupeKey = `${m.type}:${raw}`;
      let placeholder = valueToPlaceholder.get(dedupeKey);
      if (!placeholder) {
        seq[m.type] = (seq[m.type] || 0) + 1;
        placeholder = `[${m.type}_${seq[m.type]}]`;
        valueToPlaceholder.set(dedupeKey, placeholder);
        mapping[placeholder] = raw;
      }
      counts[m.type] = (counts[m.type] || 0) + 1;
      result += text.slice(cursor, m.start) + placeholder;
      cursor = m.end;
    }
    result += text.slice(cursor);
    return result;
  }

  return {
    mask,
    mapping,
    counts,
  };
}

// Replaces every placeholder in `text` that this session's mapping knows
// about with its real value. A placeholder NOT in the mapping (e.g. one
// baked into a cached answer from a different caller's request) is left
// exactly as-is - restoring it would mean guessing at someone else's real
// data, which this never does.
export function restore(text, mapping) {
  if (!mapping || Object.keys(mapping).length === 0) return text;
  return text.replace(PLACEHOLDER_REGEX, (placeholder) =>
    Object.prototype.hasOwnProperty.call(mapping, placeholder) ? mapping[placeholder] : placeholder
  );
}

// Buffers streamed text so a placeholder split across two SSE chunks (e.g.
// "[EMA" then "IL_1]") is never sent to the client half-restored. Only
// needed when restoreInResponse is on AND this request's session actually
// masked something - callers should skip wrapping deltas in this at all
// otherwise, so a request with nothing to redact streams exactly as before.
export function createStreamRestorer(mapping) {
  let buffer = "";

  function process(delta) {
    buffer += delta;
    const lastOpen = buffer.lastIndexOf("[");
    const lastClose = buffer.lastIndexOf("]");
    // An unmatched "[" near the end might be the start of a placeholder
    // that hasn't fully arrived yet - hold everything from there onward
    // back until a closing "]" shows up (or the stream ends, see flush()).
    const safeEnd = lastOpen > lastClose ? lastOpen : buffer.length;
    const toEmit = buffer.slice(0, safeEnd);
    buffer = buffer.slice(safeEnd);
    return toEmit ? restore(toEmit, mapping) : "";
  }

  function flush() {
    const toEmit = buffer;
    buffer = "";
    return toEmit ? restore(toEmit, mapping) : "";
  }

  return { process, flush };
}
