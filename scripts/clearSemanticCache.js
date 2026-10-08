// Run with: node scripts/clearSemanticCache.js (or: npm run clear-semantic-cache)
// Deletes every stored semantic cache entry and drops+recreates the Redis
// vector index. Needed after any change to how embeddings are computed
// (model, dimension, task type, normalization) - old vectors are not
// comparable to new ones and would otherwise linger as silently wrong matches.
import { clearSemanticCache } from "../src/services/semanticCache.service.js";

async function main() {
  const deletedCount = await clearSemanticCache();
  console.log(`Cleared ${deletedCount} semantic cache entr${deletedCount === 1 ? "y" : "ies"} and recreated the index.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Failed to clear semantic cache:", error.message);
  process.exit(1);
});
