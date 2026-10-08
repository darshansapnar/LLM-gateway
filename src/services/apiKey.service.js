// Shared gateway-API-key generation logic. Both scripts/createApiKey.js
// (the CLI) and POST /v1/admin/keys (the dashboard's "Create API key"
// dialog) call createApiKey() below instead of each rolling their own copy -
// this is the one place that decides what a new key looks like and how it's
// hashed before being stored, so the two can never quietly drift apart.
//
// Hashing/storage itself is unchanged from before this file existed:
// SHA-256 hex digest, only the hash is ever written to Mongo. See auth.js
// for the matching verification side (not touched - it already re-derives
// the same hash from whatever key a caller presents and looks it up).
import crypto from "crypto";
import { ApiKey } from "../models/ApiKey.js";

export function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Generates a brand-new raw key, stores only its hash (plus whatever
// limits/flags were given - anything left `undefined` falls back to the
// ApiKey schema's own defaults, same as the CLI has always relied on), and
// returns both the saved document and the raw key. The raw key is NEVER
// persisted anywhere - this return value is the only place it ever exists
// after this function returns, so the caller must hand it to the user
// immediately (print it / show it once) or it's gone for good.
export async function createApiKey({ name, requestsPerMinute, tokensPerDay, semanticCacheEnabled }) {
  const rawKey = "gw_" + crypto.randomBytes(16).toString("hex"); // 32 random hex chars

  const key = await ApiKey.create({
    name,
    keyHash: hashKey(rawKey),
    keyPrefix: rawKey.slice(0, 8),
    ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
    ...(tokensPerDay !== undefined ? { tokensPerDay } : {}),
    ...(semanticCacheEnabled !== undefined ? { semanticCacheEnabled } : {}),
  });

  return { key, rawKey };
}
