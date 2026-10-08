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
  return "neutral";
}

export function cacheTypeTone(cacheType) {
  if (cacheType === "exact") return "good";
  if (cacheType === "semantic") return "accent";
  return "neutral";
}
