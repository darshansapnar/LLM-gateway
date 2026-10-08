// Checks the "Authorization: Bearer <key>" header against stored API keys.
// On success, attaches the key document to req.apiKey so later middleware
// (rate limiting) and routes know who is calling and what their limits are.
import crypto from "crypto";
import { ApiKey } from "../models/ApiKey.js";

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const rawKey = header.slice("Bearer ".length).trim();
  const keyHash = hashKey(rawKey);

  const apiKey = await ApiKey.findOne({ keyHash });

  if (!apiKey || !apiKey.isActive) {
    return res.status(401).json({ error: "Invalid or inactive API key" });
  }

  req.apiKey = apiKey;
  next();
}
