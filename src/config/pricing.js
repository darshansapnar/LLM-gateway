// Price per 1,000,000 tokens, in USD, for every model this gateway can call.
//
// *** ALL NUMBERS BELOW ARE PLACEHOLDERS *** - verify the real current
// prices before trusting costUsd for anything beyond rough estimates:
//   Groq:   https://groq.com/pricing
//   Gemini: https://ai.google.dev/gemini-api/docs/pricing
//
// The keys here must exactly match the model name strings used elsewhere
// (GROQ_MODEL / GEMINI_MODEL / OPENROUTER_MODEL in .env) - if a model has
// no entry here, cost.service.js will log a warning and report $0 for it.
// Exception: any OpenRouter model ending in ":free" is always $0 and never
// needs an entry here (handled directly in cost.service.js).
//
// OpenRouter is currently unused (not in PROVIDER_ORDER) - if it's switched
// back on and OPENROUTER_MODEL shares a name with a Groq model, double check
// their actual prices aren't different before trusting a shared entry.
export const pricing = {
  "openai/gpt-oss-120b": {
    inputPerMillion: 0.15, // PLACEHOLDER - verify at groq.com/pricing
    outputPerMillion: 0.75, // PLACEHOLDER - verify at groq.com/pricing
  },
  "gemini-3.5-flash-lite": {
    inputPerMillion: 0.1, // PLACEHOLDER - verify at ai.google.dev/gemini-api/docs/pricing
    outputPerMillion: 0.4, // PLACEHOLDER - verify at ai.google.dev/gemini-api/docs/pricing
  },
};
