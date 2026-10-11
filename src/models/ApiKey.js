// Defines a gateway API key: who it belongs to and what limits apply to it.
// We never store the real key - only its SHA-256 hash (see auth.js and
// scripts/createApiKey.js) - so a database leak doesn't leak usable keys.
import mongoose from "mongoose";
import { PII_TYPES } from "../config/piiTypes.js";

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
  // PII redaction (see docs/pii-redaction.md) - on ("mask") by default,
  // unlike semantic caching: masking carries no correctness risk the way a
  // wrong cache hit does, so there's no reason to make callers opt in.
  // "off" disables detection entirely; "block" rejects the request (422)
  // instead of masking and forwarding it.
  piiMode: { type: String, enum: ["off", "mask", "block"], default: "mask" },
  piiTypes: { type: [String], enum: PII_TYPES, default: PII_TYPES },
  // Whether the client gets real values restored in the answer, or sees
  // the raw [EMAIL_1]-style placeholders. Default true - most callers want
  // their own data back; a caller doing bulk/offline processing of answers
  // it shouldn't see raw PII in can turn this off.
  restoreInResponse: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export const ApiKey = mongoose.model("ApiKey", apiKeySchema);
