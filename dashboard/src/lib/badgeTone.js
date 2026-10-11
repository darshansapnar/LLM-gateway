// Maps backend enum values to a Badge "tone" (good/warn/bad/neutral/accent).
// Centralized here so the same circuit-breaker state or request status
// always renders the same color everywhere in the app.
export function circuitTone(state) {
  if (state === "CLOSED") return "good";
  if (state === "HALF_OPEN") return "warn";
  if (state === "OPEN") return "bad";
  return "neutral";
}

export function requestStatusTone(status) {
  if (status === "success") return "good";
  if (status === "cancelled") return "warn";
  if (status === "error") return "bad";
  // "blocked" (PII mode "block" rejected the request) is policy working as
  // intended, not a system failure - warn (not bad) reflects that.
  if (status === "blocked") return "warn";
  return "neutral";
}

// piiMode -> Badge tone for the API Keys table / edit dialog.
export function piiModeTone(piiMode) {
  if (piiMode === "off") return "neutral";
  if (piiMode === "block") return "bad";
  return "good"; // "mask"
}

export function cacheTypeTone(cacheType) {
  if (cacheType === "exact") return "good";
  if (cacheType === "semantic") return "accent";
  return "neutral";
}
