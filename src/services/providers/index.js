// Maps a provider name (as used in PROVIDER_ORDER) to its "ask" function.
// Every function here takes a prompt and returns the same shape:
// { text, inputTokens, outputTokens, model }. router.service.js is the only
// thing that calls into this file, so adding a new provider later just
// means writing one more file like these and adding one line here.
import { askGroq, askGroqStream } from "./groq.service.js";
import { askGemini, askGeminiStream } from "./gemini.service.js";
import { askOpenRouter } from "./openrouter.service.js";

export const providers = {
  groq: askGroq,
  gemini: askGemini,
  openrouter: askOpenRouter,
};

// Streaming versions. OpenRouter has none yet - a provider missing here is
// simply skipped by the streaming router, same as an unknown name would be.
export const streamingProviders = {
  groq: askGroqStream,
  gemini: askGeminiStream,
};
