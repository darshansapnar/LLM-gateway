// Loads variables from the .env file into process.env
import dotenv from "dotenv";

dotenv.config();

const providerOrder = (process.env.PROVIDER_ORDER || "groq,gemini")
  .split(",")
  .map((name) => name.trim());

// Which env vars each provider needs. Only the providers actually listed in
// PROVIDER_ORDER have their vars required - add a provider here once, and
// it's required/optional automatically based on whether it's in use.
const PROVIDER_ENV_VARS = {
  groq: ["GROQ_API_KEY", "GROQ_MODEL"],
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"],
  gemini: ["GEMINI_API_KEY", "GEMINI_MODEL"],
};

// Vars every setup needs, regardless of which providers are active.
const baseRequiredVars = ["PORT", "MONGO_URI", "REDIS_URL", "ADMIN_API_KEY"];

const providerRequiredVars = providerOrder.flatMap((name) => PROVIDER_ENV_VARS[name] || []);

// Semantic caching (Stage 6) always embeds with Gemini, regardless of which
// provider(s) are actually answering chats - so it needs its own key check.
const semanticCacheEnabled = (process.env.SEMANTIC_CACHE_ENABLED ?? "true") !== "false";
const semanticCacheRequiredVars = semanticCacheEnabled ? ["GEMINI_API_KEY"] : [];

const requiredVars = [
  ...new Set([...baseRequiredVars, ...providerRequiredVars, ...semanticCacheRequiredVars]),
];

// Check that each required variable actually has a value.
// We fail fast (exit immediately) instead of letting the app
// start in a broken state and crash later with a confusing error.
const missingVars = requiredVars.filter((name) => !process.env[name]);

if (missingVars.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missingVars.join(", ")}`
  );
  console.error("Check your .env file against .env.example and try again.");
  process.exit(1);
}

// Export the values the rest of the app will use.
// Other files import from here instead of reading process.env directly,
// so there is one single, validated source of truth.
export const env = {
  PORT: process.env.PORT,
  MONGO_URI: process.env.MONGO_URI,
  REDIS_URL: process.env.REDIS_URL,
  // Optional - falls back to 24 hours if not set.
  CACHE_TTL_SECONDS: Number(process.env.CACHE_TTL_SECONDS) || 86400,
  // Provider credentials - each is only actually required when its provider
  // is listed in PROVIDER_ORDER (enforced above). Unused ones stay undefined.
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  // Which providers to try, in order, and the fallback knobs.
  PROVIDER_ORDER: process.env.PROVIDER_ORDER || "groq,gemini",
  PROVIDER_TIMEOUT_MS: Number(process.env.PROVIDER_TIMEOUT_MS) || 15000,
  MAX_RETRIES: Number(process.env.MAX_RETRIES) || 2,
  // Streaming: how long we'll wait with no new chunk arriving before giving up
  // on an in-progress stream (separate from PROVIDER_TIMEOUT_MS, which only
  // covers waiting for the FIRST chunk).
  STREAM_IDLE_TIMEOUT_MS: Number(process.env.STREAM_IDLE_TIMEOUT_MS) || 10000,
  // Semantic caching: embed prompts and match on meaning, not exact text.
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || "gemini-embedding-001",
  EMBEDDING_DIM: Number(process.env.EMBEDDING_DIM) || 768,
  SEMANTIC_CACHE_ENABLED: semanticCacheEnabled,
  // Lowered from 0.92: the eval showed embedding similarity alone can't
  // reliably separate paraphrases (0.91-0.99) from opposites (0.83-0.955) -
  // cacheVerifier.service.js's antonym guard + LLM judge do that job instead,
  // so this threshold now only needs to catch "plausible candidates".
  SIMILARITY_THRESHOLD: Number(process.env.SIMILARITY_THRESHOLD) || 0.9,
  // The LLM judge double-checks any semantic candidate that survives the
  // antonym guard. Disabling it is faster/cheaper but less safe.
  SEMANTIC_JUDGE_ENABLED: (process.env.SEMANTIC_JUDGE_ENABLED ?? "true") !== "false",
  JUDGE_TIMEOUT_MS: Number(process.env.JUDGE_TIMEOUT_MS) || 3000,
  // A candidate this similar skips the judge entirely and is accepted
  // outright - UNLESS it has an entity difference (different country,
  // language, framework, etc.), which always goes to the judge regardless
  // of how similar the wording is (see cacheVerifier.service.js).
  JUDGE_SKIP_ABOVE: Number(process.env.JUDGE_SKIP_ABOVE) || 0.97,
  // Dashboard (Stage 7): a single shared admin key, checked via the
  // "x-admin-key" header - separate from per-caller API keys, since the
  // dashboard needs to see ACROSS all keys, not act as one of them.
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  // Which origin the dashboard's browser requests are allowed to come from.
  DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN || "http://localhost:5173",
};
