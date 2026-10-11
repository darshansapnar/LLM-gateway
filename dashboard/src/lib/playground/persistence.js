// Optional sessionStorage mirror for Playground's state, so a page REFRESH
// (not just navigating to another dashboard tab - that's handled by
// PlaygroundStore.jsx living above the page itself) doesn't lose what was
// being built. sessionStorage, not localStorage - cleared when the tab
// closes, same policy as the gateway API key's own "remember" storage.
//
// Deliberately excluded, even when "remember" would otherwise apply:
//   - the gateway API key itself (that's useRememberedApiKey's own,
//     separate, already-reviewed opt-in sessionStorage key - this module
//     never touches it and never duplicates the key into its own blob)
//   - the last response (may contain PII restored to its real value for
//     this caller - never written to any storage, only kept in memory)
//   - history entries' full response/snapshot - see toPersistableHistory()
const STORAGE_KEY = "llm-gateway-playground-state";

const FIELDS = ["endpoint", "headers", "bodyText", "streamEnabled", "bypassEnabled", "history"];

// Strips what Playground actually sends over the network for "Re-send"
// down to the non-secret parts (the body + whether it streamed) and drops
// the response entirely - a resend after a page refresh rebuilds headers
// fresh from whatever's currently in the Gateway API Key field, rather
// than replaying a frozen "Authorization: Bearer <real key>" from before
// the refresh (which would mean writing the real key to sessionStorage).
export function toPersistableHistory(history) {
  return history.map((item) => ({
    id: item.id,
    time: item.time,
    prompt: item.prompt,
    status: item.status,
    statusTone: item.statusTone,
    provider: item.provider,
    cacheLabel: item.cacheLabel,
    cacheTone: item.cacheTone,
    latencyMs: item.latencyMs,
    snapshot: { bodyObject: item.snapshot?.bodyObject, isStream: item.snapshot?.isStream },
  }));
}

export function loadPersistedState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    // Private browsing / blocked storage / corrupted JSON - start fresh.
    return null;
  }
}

export function savePersistedState(state) {
  try {
    const toSave = {};
    for (const field of FIELDS) toSave[field] = state[field];
    toSave.history = toPersistableHistory(toSave.history || []);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Storage full / blocked - the state just won't survive a refresh.
  }
}

export function clearPersistedState() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do - if removeItem fails, getItem will too, so a later
    // load just won't see stale data from before this call either way.
  }
}
