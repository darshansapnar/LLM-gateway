// Defines a gateway API key: who it belongs to and what limits apply to it.
// We never store the real key - only its SHA-256 hash (see auth.js and
// scripts/createApiKey.js) - so a database leak doesn't leak usable keys.
import mongoose from "mongoose";

const apiKeySchema = new mongoose.Schema({
  name: { type: String, required: true },
  keyHash: { type: String, required: true, unique: true },
  keyPrefix: { type: String, required: true },
  requestsPerMinute: { type: Number, default: 20 },
  tokensPerDay: { type: Number, default: 50000 },
  isActive: { type: Boolean, default: true },
  // Opt-in: semantic (similar-meaning) caching has a small but real risk of
  // a wrong match (see cacheVerifier.service.js), so it's off by default.
  // Exact-match caching is unaffected and always on for every key.
  semanticCacheEnabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export const ApiKey = mongoose.model("ApiKey", apiKeySchema);
