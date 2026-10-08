// Run with: node scripts/createApiKey.js <name> [--semantic]
// (or: npm run create-key -- <name> --semantic)
// Generates a new gateway API key, stores only its SHA-256 hash in MongoDB,
// and prints the real key once. There is no way to recover it afterwards -
// if it's lost, create a new one.
//
// Key generation/hashing itself lives in src/services/apiKey.service.js,
// shared with POST /v1/admin/keys (the dashboard's "Create API key"
// dialog) - this script is just a thin CLI wrapper around it, so both ways
// of creating a key produce an identical result.
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { createApiKey } from "../src/services/apiKey.service.js";

const args = process.argv.slice(2);
const semanticCacheEnabled = args.includes("--semantic");
const name = args.find((arg) => !arg.startsWith("--"));

if (!name) {
  console.error("Usage: node scripts/createApiKey.js <name> [--semantic]");
  process.exit(1);
}

async function main() {
  await mongoose.connect(env.MONGO_URI);

  const { rawKey } = await createApiKey({ name, semanticCacheEnabled });

  console.log(`API key created for "${name}". Save it now - it will not be shown again:`);
  console.log(rawKey);
  console.log(`Semantic caching: ${semanticCacheEnabled ? "enabled" : "disabled"} (exact caching is always on)`);

  await mongoose.disconnect();
}

main();
