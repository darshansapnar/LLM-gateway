import { useEffect, useState } from "react";

const STORAGE_KEY = "llm-gateway-playground-api-key";

// sessionStorage (not localStorage) is the whole point here: it survives a
// page refresh but is cleared the moment the tab closes - "remember on
// this device" was never meant to mean "forever".
function readStoredKey() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    // Private browsing / blocked storage - behave as if nothing was remembered.
    return "";
  }
}

// Lets the Playground page optionally remember the GATEWAY API key a
// developer typed in, so it survives a refresh. Unchecked by default - the
// key is written to sessionStorage only once the developer explicitly
// opts in via "Remember key on this device"; unchecking (or clearing the
// field) removes it immediately rather than leaving a stale copy behind.
//
// Scope: this is for the per-caller gateway key typed into Playground
// ONLY. It must never be reused for GROQ_API_KEY/GEMINI_API_KEY/
// OPENROUTER_API_KEY (server-side secrets the frontend never even sees) or
// ADMIN_API_KEY (Login.jsx keeps that in memory only, with no remember
// option at all).
export function useRememberedApiKey() {
  const [apiKey, setApiKey] = useState(readStoredKey);
  const [remember, setRemember] = useState(() => readStoredKey() !== "");

  useEffect(() => {
    try {
      if (remember && apiKey) {
        sessionStorage.setItem(STORAGE_KEY, apiKey);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore - the key just won't persist across a refresh.
    }
  }, [remember, apiKey]);

  return { apiKey, setApiKey, remember, setRemember };
}
