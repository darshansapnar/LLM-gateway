// Checks the "x-admin-key" header against a single shared secret
// (ADMIN_API_KEY). Unlike auth.js, there's no database lookup - the
// dashboard isn't "one of the callers", it needs to see across all of
// them, so it gets one separate secret instead of a per-caller API key.
import crypto from "crypto";
import { env } from "../config/env.js";

// Constant-time comparison so a wrong guess can't be narrowed down by how
// long the comparison took (a timing side-channel) - cheap to do, so there's
// no reason not to, even though this is a learning project's admin key.
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function adminAuth(req, res, next) {
  const key = req.headers["x-admin-key"];

  if (!key || !safeEqual(key, env.ADMIN_API_KEY)) {
    return res.status(401).json({ error: "Missing or invalid x-admin-key header" });
  }

  next();
}
